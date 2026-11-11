import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import {
  getAllHooks,
  getConfigTemplate,
  getHooksConfig,
} from "../templates/codex/index.js";
import { ensureDir } from "../utils/file-writer.js";
import {
  resolvePlaceholders,
  resolveAllAsSkillsNeutral,
  resolveBundledSkills,
  collectSkillTemplates,
  collectSharedHooks,
  renderTemplateMap,
  writeTemplateMap,
} from "./shared.js";

/**
 * The Codex file set — written at init and diffed by `trellis update`.
 * - .agents/skills/ — shared skills from common source, rendered with the
 *   neutral placeholder resolver so the auto-triggered skill templates from
 *   `common/skills/` are byte-identical regardless of which platform writes
 *   them (Gemini CLI 0.40+ and Pi target `.agents/skills/` too, and
 *   last-writer-wins is only safe when both writers produce identical output).
 * - .codex/agents/ — custom agent profiles. Native Codex SubagentStart hooks
 *   push role-specific context; each profile also carries a marker-gated pull
 *   fallback for untrusted or unavailable hooks, so no unconditional prelude.
 * - .codex/hooks/, hooks.json — hooks.json registers UserPromptSubmit for the
 *   main session; SubagentStart is registered for role-specific shared context.
 * - .codex/config.toml — platform config.
 */
export function collectCodexTemplates(): Map<string, string> {
  const files = new Map<string, string>();
  const ctx = AI_TOOLS.codex.templateContext;

  for (const [filePath, content] of collectSkillTemplates(
    ".agents/skills",
    resolveAllAsSkillsNeutral(ctx),
    resolveBundledSkills(ctx),
  )) {
    files.set(filePath, content);
  }
  for (const hook of getAllHooks()) {
    files.set(`.codex/hooks/${hook.name}`, hook.content);
  }
  // Shared hooks (inject-workflow-state.py + native SubagentStart context).
  for (const [k, v] of collectSharedHooks(".codex/hooks", "codex")) {
    files.set(k, v);
  }
  files.set(".codex/hooks.json", resolvePlaceholders(getHooksConfig()));
  const config = getConfigTemplate();
  files.set(`.codex/${config.targetPath}`, config.content);

  return files;
}

/**
 * Configure Codex by writing `collectCodexTemplates`, plus the one piece of
 * behavior a `Map<path, content>` cannot carry.
 */
export async function configureCodex(cwd: string): Promise<void> {
  // Build map → post-process map → write. Rendered up front so the preserved
  // user keys are grafted onto exactly the bytes `trellis update` compares
  // against — update.ts runs preserveCodexAgentModelKeys over its already
  // rendered map too, and the two must agree. writeTemplateMap re-renders,
  // which is a no-op (replacePythonCommandLiterals is idempotent).
  const files = renderTemplateMap(collectCodexTemplates());
  await writeTemplateMap(cwd, files);

  // RESIDUAL — not expressible as a path→content pair: a directory with no
  // files in it. Trellis ships no Codex-specific skills (the workflow skills
  // all land in .agents/skills/, which Codex reads too), but users need the
  // conventional place for their own, and manifest-prune.ts treats
  // `.codex/skills/<custom>/` as user-owned data the manifest must not claim.
  ensureDir(path.join(cwd, ".codex", "skills"));

  // NOTE: Codex hooks require `features.hooks = true` in the user's
  // ~/.codex/config.toml (Codex 0.129+). The legacy `features.codex_hooks = true`
  // still works on 0.129+ but emits a deprecation warning; pre-0.129 only
  // accepts `codex_hooks`. Without this flag the hooks.json is ignored and
  // inject-workflow-state.py will never fire. Codex 0.129+ also gates each
  // installed hook behind a one-time `/hooks` review — until the user approves
  // it the workflow breadcrumb won't auto-inject (the trellis-bootstrap
  // fallback in inject-workflow-state.py covers this case). Documented in
  // spec/cli/backend/platform-integration.md.
  if (!process.env.VITEST && !process.env.TRELLIS_QUIET) {
    process.stderr.write(
      "⚠️  Codex hooks require `features.hooks = true` in your " +
        "~/.codex/config.toml (Codex 0.129+; older versions: `codex_hooks = true`). " +
        "On Codex 0.129+ also run `/hooks` once to approve the Trellis " +
        "hooks. Without these the workflow breadcrumb will not auto-inject. " +
        "See Trellis docs for details.\n",
    );
  }
}
