/**
 * Workflow template resolver.
 *
 * Centralizes bundled and explicitly sourced custom workflow resolution. The
 * native workflow is resolved directly from `workflowMdTemplate`.
 *
 * Boundary: command-layer callers (init.ts, commands/workflow.ts) should NOT
 * touch raw remote registry structures. They go through `resolveWorkflowTemplate`
 * and `listWorkflowTemplates` only.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { workflowMdTemplate } from "../templates/trellis/index.js";
import {
  TIMEOUTS,
  RegistryBackendError,
  parseRegistrySource,
  probeRegistryIndex,
  type RegistryBackend,
  type RegistrySource,
  type SpecTemplate,
} from "./template-fetcher.js";

/**
 * The id used to refer to the bundled native workflow.
 *
 * Treated as Trellis-managed for hash-tracking: when this id is selected by
 * `init --workflow` or `trellis workflow`, `.trellis/workflow.md` stays in
 * `.template-hashes.json`. Any other id is user-managed local workflow and
 * must be removed from the hash file (the durable-state contract in
 * design.md "Durable-state contract").
 */
export const NATIVE_WORKFLOW_ID = "native";

/**
 * Resolved workflow template entry.
 *
 * `content` is the workflow.md body bytes (LF-normalized in storage).
 * `path` is relative to the custom source for remote entries, or
 *   `bundled:trellis/workflow.md` for the native entry.
 */
export interface ResolvedWorkflowTemplate {
  id: string;
  type: "workflow";
  name: string;
  description?: string;
  path: string;
  content: string;
  /** Where the content came from (for error messages). */
  source: "bundled" | "custom";
}

/**
 * Workflow template listing (metadata only, no content).
 */
export interface WorkflowTemplateListing {
  id: string;
  type: "workflow";
  name: string;
  description?: string;
  path: string;
  source: "bundled" | "custom";
}

export interface WorkflowResolveOptions {
  /**
   * Optional explicit source for a custom workflow (giget-style or HTTPS URL).
   */
  source?: string;
}

export class WorkflowResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowResolveError";
  }
}

/**
 * Bundled native workflow entry — virtual, resolved without network access.
 */
function nativeListingEntry(): WorkflowTemplateListing {
  return {
    id: NATIVE_WORKFLOW_ID,
    type: "workflow",
    name: "Native Trellis Workflow",
    description: "Trellis workflow bundled with the CLI",
    path: "bundled:trellis/workflow.md",
    source: "bundled",
  };
}

function nativeResolvedEntry(): ResolvedWorkflowTemplate {
  return {
    ...nativeListingEntry(),
    content: workflowMdTemplate,
  };
}

function parseSourceOrThrow(source: string): RegistrySource {
  try {
    return parseRegistrySource(source);
  } catch (err) {
    throw new WorkflowResolveError(
      `Invalid custom workflow source "${source}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

async function fetchWorkflowEntries(
  registry: RegistrySource | undefined,
  indexUrl: string,
): Promise<{
  templates: SpecTemplate[];
  backend?: RegistryBackend;
  errorMessage?: string;
}> {
  const probe = await probeRegistryIndex(indexUrl, registry);
  if (probe.error) {
    return {
      templates: [],
      backend: probe.backend,
      errorMessage: probe.error.message,
    };
  }
  if (probe.isNotFound) {
    return {
      templates: [],
      backend: probe.backend,
      errorMessage:
        "No index.json found at the configured custom workflow source.",
    };
  }
  return { templates: probe.templates, backend: probe.backend };
}

/**
 * List bundled and explicitly sourced custom workflow templates.
 *
 * Returns metadata only — no content is fetched. Use `resolveWorkflowTemplate`
 * to fetch the actual workflow.md bytes for a chosen id.
 *
 * Network errors are surfaced as `errorMessage`. The native entry is still
 * returned so callers can fall back to it offline.
 */
export async function listWorkflowTemplates(
  options: WorkflowResolveOptions = {},
): Promise<{
  templates: WorkflowTemplateListing[];
  errorMessage?: string;
}> {
  const result: WorkflowTemplateListing[] = [nativeListingEntry()];

  if (!options.source) return { templates: result };

  const registry = parseSourceOrThrow(options.source);
  const indexUrl = `${registry.rawBaseUrl}/index.json`;

  const fetched = await fetchWorkflowEntries(registry, indexUrl);
  if (fetched.errorMessage) {
    return { templates: result, errorMessage: fetched.errorMessage };
  }

  for (const t of fetched.templates) {
    if (t.type !== "workflow") continue;
    if (t.id === NATIVE_WORKFLOW_ID) continue;
    result.push({
      id: t.id,
      type: "workflow",
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      path: t.path,
      source: "custom",
    });
  }

  return { templates: result };
}

/**
 * Resolve a workflow id to its content.
 *
 * - `native` → bundled `workflowMdTemplate` (offline, never errors).
 * - other id → require an explicit custom source, then fetch its index and file.
 *
 * Errors are workflow-specific (do NOT reuse "spec template not found" copy).
 */
export async function resolveWorkflowTemplate(
  id: string,
  options: WorkflowResolveOptions = {},
): Promise<ResolvedWorkflowTemplate> {
  if (id === NATIVE_WORKFLOW_ID) {
    return nativeResolvedEntry();
  }

  if (!options.source) {
    throw new WorkflowResolveError(
      `Workflow template "${id}" requires an explicit custom workflow source.`,
    );
  }
  const registry = parseSourceOrThrow(options.source);
  const indexUrl = `${registry.rawBaseUrl}/index.json`;

  const fetched = await fetchWorkflowEntries(registry, indexUrl);
  if (fetched.errorMessage) {
    throw new WorkflowResolveError(
      `Could not fetch workflow template index: ${fetched.errorMessage}`,
    );
  }

  const entry = fetched.templates.find(
    (t) => t.id === id && t.type === "workflow",
  );
  if (!entry) {
    const available = fetched.templates
      .filter((t) => t.type === "workflow")
      .map((t) => t.id);
    const hint =
      available.length > 0
        ? ` Available workflow templates: ${available.join(", ")}`
        : "";
    throw new WorkflowResolveError(
      `Workflow template "${id}" not found in the custom workflow index.${hint}`,
    );
  }
  if (!entry.path?.endsWith(".md")) {
    throw new WorkflowResolveError(
      `Workflow template "${id}" has invalid path "${entry.path}" — must point to a workflow.md file.`,
    );
  }

  const backend = fetched.backend;
  const content = await fetchWorkflowFile(entry.path, registry, backend);

  return {
    id: entry.id,
    type: "workflow",
    name: entry.name,
    ...(entry.description ? { description: entry.description } : {}),
    path: entry.path,
    content,
    source: "custom",
  };
}

async function fetchWorkflowFile(
  relativePath: string,
  registry: RegistrySource,
  backend: RegistryBackend | undefined,
): Promise<string> {
  validateWorkflowPath(relativePath);
  const useGit = registry.preferGit || backend === "git";
  if (useGit) {
    return fetchWorkflowFileGit(registry, relativePath);
  }
  return fetchWorkflowFileHttp(registry.rawBaseUrl, relativePath);
}

async function fetchWorkflowFileHttp(
  rawBaseUrl: string,
  relativePath: string,
): Promise<string> {
  const url = `${rawBaseUrl.replace(/\/$/, "")}/${relativePath}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUTS.DOWNLOAD_MS),
    });
    if (res.status === 404) {
      throw new WorkflowResolveError(
        `Workflow template file not found at ${url}.`,
      );
    }
    if (!res.ok) {
      throw new WorkflowResolveError(
        `Could not fetch workflow template (HTTP ${res.status}) from ${url}.`,
      );
    }
    return await res.text();
  } catch (err) {
    if (err instanceof WorkflowResolveError) throw err;
    throw new WorkflowResolveError(
      `Workflow template download failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function validateWorkflowPath(relativePath: string): void {
  const normalized = relativePath.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new WorkflowResolveError(
      `Workflow template path "${relativePath}" must stay inside the custom source.`,
    );
  }
}

async function fetchWorkflowFileGit(
  registry: RegistrySource,
  relativePath: string,
): Promise<string> {
  // Single shallow clone of the registry ref, then read one file. We don't
  // share clone state with template-fetcher's downloadGitRegistryPath because
  // workflow resolution is a single-file fetch (not a directory copy).
  const { execFile } = await import("node:child_process");
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "trellis-workflow-"),
  );

  function run(args: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      execFile(
        "git",
        args,
        {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
          timeout: TIMEOUTS.DOWNLOAD_MS,
        },
        (error) => {
          if (error) reject(error);
          else resolve();
        },
      );
    });
  }

  try {
    try {
      await run([
        "clone",
        "--filter=blob:none",
        "--no-checkout",
        registry.gitUrl,
        dir,
      ]);
      await run(["-C", dir, "fetch", "--depth", "1", "origin", registry.ref]);
      await run(["-C", dir, "checkout", "--detach", "FETCH_HEAD"]);
    } catch (err) {
      throw new RegistryBackendError(
        "network",
        `Could not clone registry ${registry.gitUrl}#${registry.ref}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const subdir = registry.subdir.length > 0 ? registry.subdir : ".";
    const sourceRoot = path.resolve(dir, subdir);
    const candidatePath = path.resolve(sourceRoot, relativePath);
    const rel = path.relative(sourceRoot, candidatePath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new WorkflowResolveError(
        `Workflow template path "${relativePath}" escapes the custom source.`,
      );
    }
    if (!fs.existsSync(candidatePath)) {
      throw new WorkflowResolveError(
        `Workflow template file "${relativePath}" not found in ${registry.gitUrl}#${registry.ref}.`,
      );
    }
    return await fs.promises.readFile(candidatePath, "utf-8");
  } catch (err) {
    if (err instanceof WorkflowResolveError) throw err;
    if (err instanceof RegistryBackendError) {
      throw new WorkflowResolveError(err.message);
    }
    throw new WorkflowResolveError(
      `Workflow template download failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {
      // best-effort cleanup; the OS will reap tmp dirs eventually
    });
  }
}
