import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  assertSafeManagedPath,
  lstatIfPresent,
} from "../utils/managed-removal.js";
import { loadSpecRegistryConfig } from "../utils/registry-config.js";

import { DIR_NAMES, PATHS } from "../constants/paths.js";
import { copyTrellisDir } from "../templates/extract.js";

// Import trellis templates (generic, not project-specific)
import {
  workflowMdTemplate,
  configYamlTemplate,
  teamworkConfigTemplate,
  gitignoreTemplate,
  gitattributesTemplate,
  getAllAgents,
} from "../templates/trellis/index.js";

// Import markdown templates
import {
  agentProgressIndexContent,
  specIndexContent,
  // Guides structure
  guidesIndexContent,
  guidesCrossLayerThinkingGuideContent,
  guidesCodeReuseThinkingGuideContent,
} from "../templates/markdown/index.js";

import { writeFile, ensureDir } from "../utils/file-writer.js";
import { replacePythonCommandLiterals } from "./shared.js";
import {
  sanitizePkgName,
  type ProjectType,
  type DetectedPackage,
} from "../utils/project-detector.js";

interface DocDefinition {
  name: string;
  content: string;
}

/**
 * Options for creating workflow structure
 */
export interface WorkflowOptions {
  /** Detected or specified project type */
  projectType: ProjectType;
  /** Skip creating local spec templates (when using remote template) — single-repo mode */
  skipSpecTemplates?: boolean;
  /** Detected monorepo packages (enables monorepo spec creation) */
  packages?: DetectedPackage[];
  /** Package names that use remote templates (skip blank spec for these) */
  remoteSpecPackages?: Set<string>;
  /**
   * Optional override for `.trellis/workflow.md` content. When omitted the
   * bundled native template is written. Set by `init --workflow` (or
   * `--workflow-source`) after the resolver has fetched custom workflow content.
   * Caller is still responsible for removing the `.trellis/workflow.md` hash
   * entry for non-native workflows so update.ts treats them as user-managed.
   */
  workflowMdOverride?: string;
}

/**
 * Regex used to detect an existing `journal-*.md merge=union` gitattributes
 * rule (any whitespace variant), so `ensureGitattributes` never appends a
 * duplicate entry to a project's pre-existing `.gitattributes`.
 */
const JOURNAL_MERGE_UNION_PATTERN = /journal-\*\.md\s+merge=union/;

/**
 * Ensure the project-root `.gitattributes` carries the journal `merge=union`
 * rule, without ever overwriting a user's existing file wholesale.
 *
 * - No `.gitattributes` yet: write the bundled template directly.
 * - Existing file that already has a `journal-*.md merge=union` rule (user's
 *   own or from a previous `trellis init`/`update`): no-op, avoids duplicates.
 * - Existing file without that rule: append the bundled template content.
 *
 * Intentionally does NOT go through the standard `writeFile` conflict-prompt
 * flow — this file is additive-only and never a candidate for whole-file
 * overwrite.
 */
export function ensureGitattributes(cwd: string): void {
  const targetPath = path.join(cwd, ".gitattributes");

  if (!fs.existsSync(targetPath)) {
    fs.writeFileSync(targetPath, gitattributesTemplate);
    return;
  }

  const existing = fs.readFileSync(targetPath, "utf-8");
  if (JOURNAL_MERGE_UNION_PATTERN.test(existing)) {
    return;
  }

  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  fs.writeFileSync(targetPath, existing + separator + gitattributesTemplate);
}

/**
 * Create workflow structure based on project type
 *
 * This function creates the .trellis/ directory structure by:
 * 1. Copying scripts/ directory directly (dogfooding)
 * 2. Copying workflow.md and .gitignore (dogfooding)
 * 3. Creating workspace/ with index.md
 * 4. Creating tasks/ directory
 * 5. Creating spec/ with templates (not dogfooded - generic templates)
 *
 * @param cwd - Current working directory
 * @param options - Workflow options including project type
 */
export async function createWorkflowStructure(
  cwd: string,
  options?: WorkflowOptions,
): Promise<void> {
  const skipSpecTemplates =
    (options?.skipSpecTemplates ?? false) || specHasExternalSource(cwd);
  const packages = options?.packages;
  const remoteSpecPackages = options?.remoteSpecPackages;
  const workflowMd = options?.workflowMdOverride ?? workflowMdTemplate;

  // Create base .trellis directory
  ensureDir(path.join(cwd, DIR_NAMES.WORKFLOW));

  // Copy scripts/ directory from templates
  await copyTrellisDir("scripts", path.join(cwd, PATHS.SCRIPTS), {
    executable: true,
  });

  // Copy workflow.md (bundled native template or explicitly sourced custom workflow)
  await writeFile(
    path.join(cwd, PATHS.WORKFLOW_GUIDE_FILE),
    replacePythonCommandLiterals(workflowMd),
  );

  // Copy .gitignore from templates
  await writeFile(
    path.join(cwd, DIR_NAMES.WORKFLOW, ".gitignore"),
    gitignoreTemplate,
  );

  // Copy config.yaml from templates
  await writeFile(
    path.join(cwd, DIR_NAMES.WORKFLOW, "config.yaml"),
    configYamlTemplate,
  );
  await writeFile(
    path.join(cwd, DIR_NAMES.WORKFLOW, "teamwork.json"),
    teamworkConfigTemplate,
  );

  // Ensure project-root .gitattributes carries the journal merge=union rule
  // (additive-only — never overwrites a user's existing file wholesale).
  ensureGitattributes(cwd);

  // Dispatch Teamwork runtime agent definitions. These are platform-agnostic
  // Trellis runtime files consumed by `trellis teamwork spawn --agent <name>`
  // through `packages/cli/src/commands/teamwork/agent-loader.ts`. They are
  // dispatched on every init regardless of selected workflow because the user
  // can switch to a Teamwork-enabled workflow at any time via `trellis workflow
  // --template`.
  ensureDir(path.join(cwd, PATHS.AGENTS));
  for (const [agentFile, content] of getAllAgents()) {
    ensureDir(path.dirname(path.join(cwd, PATHS.AGENTS, agentFile)));
    await writeFile(path.join(cwd, PATHS.AGENTS, agentFile), content);
  }

  // Create workspace/ with index.md
  ensureDir(path.join(cwd, PATHS.WORKSPACE));
  await writeFile(
    path.join(cwd, PATHS.WORKSPACE, "index.md"),
    replacePythonCommandLiterals(agentProgressIndexContent),
  );

  // Create tasks/ directory
  ensureDir(path.join(cwd, PATHS.TASKS));

  // Create spec templates based on project type
  // These are NOT dogfooded - they are generic templates for new projects
  if (packages && packages.length > 0 && !skipSpecTemplates) {
    // Monorepo mode: create per-package spec directories
    await createSpecTemplates(cwd, packages, remoteSpecPackages);
  } else if (!skipSpecTemplates) {
    // Single-repo mode: create global spec (skip if using remote template)
    await createSpecTemplates(cwd);
  }
}

function safeSpecPath(cwd: string, relativePath: string): string {
  const target = assertSafeManagedPath(cwd, relativePath);
  let current = path.resolve(cwd);
  const parts = relativePath.split("/");
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = lstatIfPresent(current);
    if (
      stat &&
      (stat.isSymbolicLink() ||
        (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()))
    ) {
      throw new Error(`Unsafe spec path: ${relativePath}`);
    }
  }
  return target;
}

function specHasExternalSource(cwd: string): boolean {
  const config = safeSpecPath(cwd, `${DIR_NAMES.WORKFLOW}/config.yaml`);
  if (!lstatIfPresent(config)) return false;
  const content = fs.readFileSync(config, "utf8");
  if (loadSpecRegistryConfig(cwd)) return true;
  // The native registry reader supports block syntax. Unknown declarations
  // must not silently authorize a local replacement.
  if (/^\s*["']?registry["']?\s*:/m.test(content)) {
    throw new Error(
      "Cannot determine spec registry source; no local spec files were created. Check registry.spec in .trellis/config.yaml.",
    );
  }
  return false;
}

function writeMissingSpecFile(
  cwd: string,
  relativePath: string,
  content: string,
): "created" | "preserved" {
  const target = safeSpecPath(cwd, relativePath);
  if (lstatIfPresent(target)) {
    fs.readFileSync(target);
    return "preserved";
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  safeSpecPath(cwd, relativePath);
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, content, { flag: "wx" });
    try {
      fs.linkSync(temporary, target);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        (error as NodeJS.ErrnoException).code !== "EEXIST"
      )
        throw error;
      safeSpecPath(cwd, relativePath);
      fs.readFileSync(target);
      return "preserved";
    }
    return "created";
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/** Prepare only the neutral root; existing project topics belong to bootstrap. */
export function ensureSpecIndex(
  cwd: string,
  content = specIndexContent,
): "created" | "preserved" | "external" {
  if (specHasExternalSource(cwd)) return "external";
  return writeMissingSpecFile(cwd, `${PATHS.SPEC}/index.md`, content);
}

async function createSpecTemplates(
  cwd: string,
  packages?: DetectedPackage[],
  remoteSpecPackages?: Set<string>,
): Promise<void> {
  // Ensure spec directory exists
  const navigation = packages
    ?.map((pkg) => `- [${pkg.name}](./${sanitizePkgName(pkg.name)}/index.md)`)
    .join("\n");
  ensureSpecIndex(
    cwd,
    specIndexContent + (navigation ? `\n## Packages\n\n${navigation}\n` : ""),
  );

  // Guides - always created regardless of mode
  const guidesDocs: DocDefinition[] = [
    { name: "index.md", content: guidesIndexContent },
    {
      name: "cross-layer-thinking-guide.md",
      content: guidesCrossLayerThinkingGuideContent,
    },
    {
      name: "code-reuse-thinking-guide.md",
      content: guidesCodeReuseThinkingGuideContent,
    },
  ];
  for (const doc of guidesDocs) {
    writeMissingSpecFile(cwd, `${PATHS.SPEC}/guides/${doc.name}`, doc.content);
  }

  if (packages && packages.length > 0) {
    // Monorepo mode: create spec/<name>/ for each package
    for (const pkg of packages) {
      const dirName = sanitizePkgName(pkg.name);
      if (remoteSpecPackages?.has(dirName)) continue;
      writeMissingSpecFile(
        cwd,
        `${PATHS.SPEC}/${dirName}/index.md`,
        specIndexContent,
      );
    }
  } else {
    // Single-repo mode
    ensureSpecIndex(cwd);
  }
}
