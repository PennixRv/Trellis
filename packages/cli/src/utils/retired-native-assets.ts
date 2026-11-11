import fs from "node:fs";
import retired from "../migrations/retired-native-paths.js";
import { computeHash } from "./template-hash.js";
import type { TemplateHashes } from "../types/migration.js";
import { assertSafeManagedPath, lstatIfPresent } from "./managed-removal.js";

const replacement = ".reasonix/skills/trellis-check/SKILL.md";
const paths: Record<string, string[]> = retired;
const hookFiles = [
  ".claude/settings.json",
  ".cursor/hooks.json",
  ".codex/hooks.json",
  ".factory/settings.json",
  ".codebuddy/settings.json",
  ".zcode/config.json",
  ".gemini/settings.json",
  ".qoder/settings.json",
  ".trae/hooks.json",
  ".github/copilot/hooks.json",
];
const executionFiles = [
  replacement,
  ...hookFiles,
  ".trellis/config.yaml",
  ".codex/config.toml",
  ".trellis/workflow.md",
  ...["config.py", "workflow_phase.py", "task_store.py"].map(
    (name) => `.trellis/scripts/common/${name}`,
  ),
  ".pi/extensions/trellis/index.ts",
  ".omp/extensions/trellis/index.ts",
  ".snow/hooks/write-trellis-context.py",
  ".opencode/lib/trellis-context.js",
  ...[
    "claude",
    "codex",
    "cursor",
    "factory",
    "codebuddy",
    "zcode",
    "gemini",
    "qoder",
    "trae",
    "kiro",
  ].flatMap((platform) =>
    ["inject-workflow-state.py", "inject-spec-context.py"].map(
      (name) => `.${platform}/hooks/${name}`,
    ),
  ),
];

function isRetiredHook(command: string): boolean {
  return (
    /(?:^|[\s/\\])inject-subagent-context\.py(?:[\s"']|$)/.test(command) ||
    /(?:^|[\s/\\])write-trellis-context\.py\s+subagent(?:\s|$)/.test(command)
  );
}

function scrubHooks(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(scrubHooks).filter((v) => v !== undefined);
  if (value === null || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  if (typeof object.command === "string" && isRetiredHook(object.command))
    return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(object)) {
    const cleaned = scrubHooks(child);
    if (
      cleaned !== undefined &&
      !(Array.isArray(cleaned) && cleaned.length === 0)
    )
      result[key] = cleaned;
  }
  if (Array.isArray(object.hooks) && !result.hooks) return undefined;
  return result;
}

/** Deletion-only metadata never interprets old modes as execution policy. */
function scrubConfig(relative: string, content: string, owned = false): string {
  if (hookFiles.includes(relative)) {
    if (
      !content.includes("inject-subagent-context.py") &&
      !content.includes("write-trellis-context.py subagent")
    )
      return content;
    const parsed: unknown = JSON.parse(content);
    const cleaned = scrubHooks(parsed);
    return JSON.stringify(parsed) === JSON.stringify(cleaned)
      ? content
      : JSON.stringify(cleaned ?? {}, null, 2) + "\n";
  }
  if (relative === ".trellis/config.yaml") {
    return content.replace(
      /^codex:[^\n]*\n(?:(?:[ \t]+[^\n]*|[ \t]*)\n)*/gm,
      (section) => {
        const remaining = section
          .split("\n")
          .filter((line) => !/^\s+dispatch_mode\s*:/.test(line));
        return remaining.slice(1).some((line) => /^\s+[^#\s][^:]*:/.test(line))
          ? remaining.join("\n")
          : "";
      },
    );
  }
  if (relative === ".codex/config.toml" && owned) {
    return content.replace(
      /^(\[agents\][^\n]*\n)([\s\S]*?)(?=^\[|(?![\s\S]))/gm,
      (_all, heading: string, body: string) =>
        heading + body.replace(/^\s*max_depth\s*=\s*1\s*(?:#[^\n]*)?\n/gm, ""),
    );
  }
  return content;
}

export interface NativeRetirementPlan {
  deletions: { path: string; hash: string }[];
  edits: Map<string, string>;
  originalHashes: Map<string, string>;
}

export function planNativeRetirement(
  root: string,
  hashes: TemplateHashes,
  skip: readonly string[],
): NativeRetirementPlan {
  const plan: NativeRetirementPlan = {
    deletions: [],
    edits: new Map(),
    originalHashes: new Map(),
  };
  const protectedPath = (relative: string): void => {
    if (
      skip.some(
        (item) =>
          relative === item ||
          relative.startsWith(item.replace(/\/$/, "") + "/"),
      )
    ) {
      throw new Error(
        `Retired native asset is protected by update.skip: ${relative}`,
      );
    }
  };
  const read = (relative: string): string | undefined => {
    const absolute = assertSafeManagedPath(root, relative);
    const stat = lstatIfPresent(absolute);
    if (!stat) return undefined;
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error(`Unsafe retired asset: ${relative}`);
    return fs.readFileSync(absolute, "utf8");
  };
  for (const [relative, trusted] of Object.entries(paths)) {
    const content = read(relative);
    if (content === undefined) continue;
    if (relative === replacement && !/runAs:\s*subagent/.test(content))
      continue;
    protectedPath(relative);
    const hash = computeHash(content);
    if (hash !== hashes[relative] && !trusted.includes(hash)) {
      throw new Error(
        `Modified or unowned retired native asset: ${relative}; preserve user content and resolve ownership before updating.`,
      );
    }
    if (relative !== replacement) plan.deletions.push({ path: relative, hash });
    else plan.originalHashes.set(relative, hash);
  }
  for (const relative of [
    ...hookFiles,
    ".trellis/config.yaml",
    ".codex/config.toml",
  ]) {
    const content = read(relative);
    if (content === undefined) continue;
    const cleaned = scrubConfig(
      relative,
      content,
      hashes[relative] === computeHash(content),
    );
    if (cleaned !== content) {
      protectedPath(relative);
      plan.edits.set(relative, cleaned);
      plan.originalHashes.set(relative, computeHash(content));
    }
  }
  return plan;
}

export function executeNativeRetirement(
  root: string,
  plan: NativeRetirementPlan,
): void {
  const checks = [
    ...plan.deletions,
    ...[...plan.originalHashes].map(([relative, hash]) => ({
      path: relative,
      hash,
    })),
  ];
  for (const entry of checks) {
    const absolute = assertSafeManagedPath(root, entry.path);
    const stat = fs.lstatSync(absolute);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      computeHash(fs.readFileSync(absolute, "utf8")) !== entry.hash
    ) {
      throw new Error(`Retired asset changed after preflight: ${entry.path}`);
    }
  }
  for (const entry of plan.deletions)
    fs.unlinkSync(assertSafeManagedPath(root, entry.path));
}

/** Reject live retired assets, including snapshots; history and private backups are not scanned. */
export function assertCurrentExecutionAsset(
  relative: string,
  content: string,
): void {
  const retiredPath =
    Object.hasOwn(paths, relative) && relative !== replacement;
  const oldRole = relative === replacement && /runAs:\s*subagent/.test(content);
  const active =
    relative.startsWith(".trellis/scripts/") ||
    relative === ".trellis/workflow.md" ||
    /^\.[^/]+\/(?:hooks|extensions|plugins|lib)\//.test(relative);
  const oldRuntime =
    active &&
    /get_codex_dispatch_mode|_resolve_codex_dispatch_mode|trellis_subagent|\bfunction isTrellisSubagent\b|def _agent_id\(|def _agent_kind\(|_has_subagent_platform|PI_BLOCKED_AGENT/.test(
      content,
    );
  const oldWorkflow =
    relative === ".trellis/workflow.md" &&
    /planning-inline|in_progress-inline|<codex-mode>|已配置时可使用宿主原生 agent 路径/.test(
      content,
    );
  if (
    retiredPath ||
    oldRole ||
    oldRuntime ||
    oldWorkflow ||
    scrubConfig(relative, content) !== content
  ) {
    throw new Error(
      `Retired native execution asset cannot be activated: ${relative}`,
    );
  }
}

export function assertCurrentExecutionTree(root: string): void {
  for (const relative of Object.keys(paths)) {
    const absolute = assertSafeManagedPath(root, relative);
    const stat = lstatIfPresent(absolute);
    if (!stat) continue;
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error(`Unsafe retired asset: ${relative}`);
    assertCurrentExecutionAsset(relative, fs.readFileSync(absolute, "utf8"));
  }
  for (const relative of executionFiles) {
    const absolute = assertSafeManagedPath(root, relative);
    if (lstatIfPresent(absolute)?.isFile())
      assertCurrentExecutionAsset(relative, fs.readFileSync(absolute, "utf8"));
  }
}

export function assertNativeRetirementWrites(
  root: string,
  templates: ReadonlyMap<string, string>,
  hashes: TemplateHashes,
  edits: ReadonlyMap<string, string>,
): void {
  for (const relative of executionFiles) {
    const absolute = assertSafeManagedPath(root, relative);
    const stat = lstatIfPresent(absolute);
    if (!stat) continue;
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error(`Unsafe execution asset: ${relative}`);
    const content = fs.readFileSync(absolute, "utf8");
    try {
      assertCurrentExecutionAsset(relative, content);
    } catch (error) {
      const candidate = templates.get(relative);
      if (
        candidate === undefined ||
        (!edits.has(relative) && hashes[relative] !== computeHash(content))
      )
        throw error;
      assertCurrentExecutionAsset(relative, candidate);
    }
  }
}
