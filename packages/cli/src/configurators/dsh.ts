/** Main-session platform assets and native context entry points. */

/** Main-session platform assets and native context entry points. */
import { AI_TOOLS } from "../types/ai-tools.js";
import { getDshGuide } from "../templates/dsh/index.js";
import {
  collectSkillTemplates,
  resolveAllAsSkills,
  resolveBundledSkills,
  resolveSkillsNeutral,
} from "./shared.js";

/**
 * Command templates that become user-invocable dsh skills
 * (loaded by their `trellis-<name>` skill names). The session-boundary
 * commands are delivered as SKILL.md files in DSH's private project root.
 */
const DSH_COMMAND_SKILL_NAMES = new Set([
  "trellis-start",
  "trellis-continue",
  "trellis-finish-work",
]);

/** Session-boundary commands resolved as dsh skills (dsh-private root, so
 *  platform-specific `{{CLI_FLAG}}` / `{{CMD_REF}}` resolution is correct). */
function resolveDshCommandSkills(): ReturnType<typeof resolveAllAsSkills> {
  const ctx = AI_TOOLS.dsh.templateContext;
  return resolveAllAsSkills(ctx).filter((skill) =>
    DSH_COMMAND_SKILL_NAMES.has(skill.name),
  );
}

/**
 * The DeepSeek Harness file set — written at init and diffed by `trellis update`.
 */
export function collectDshTemplates(): Map<string, string> {
  const ctx = AI_TOOLS.dsh.templateContext;
  const files = new Map<string, string>();

  // 1. Workflow + bundled skills → shared `.agents/skills/` (neutral
  //    rendering, byte-identical to Codex/Gemini/Pi/Kimi writes).
  for (const [filePath, content] of collectSkillTemplates(
    ".agents/skills",
    resolveSkillsNeutral(ctx),
    resolveBundledSkills(ctx),
  )) {
    files.set(filePath, content);
  }

  // 2. Commands-as-skills + Trellis agent prompts → `.dsh/skills/`.
  for (const [filePath, content] of collectSkillTemplates(".dsh/skills", [
    ...resolveDshCommandSkills(),
  ])) {
    files.set(filePath, content);
  }

  // 3. Operator guide → `.dsh/DSH.md`.
  files.set(".dsh/DSH.md", getDshGuide());

  return files;
}
