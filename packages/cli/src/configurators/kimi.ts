/** Main-session platform assets and native context entry points. */

import { AI_TOOLS } from "../types/ai-tools.js";
import {
  collectSkillTemplates,
  resolveAllAsSkills,
  resolveBundledSkills,
  resolveSkillsNeutral,
} from "./shared.js";

/**
 * Command templates that become user-invocable Kimi skills
 * (`/skill:trellis-<name>`). Kimi has no slash-command mechanism besides
 * skills, so the session-boundary commands are delivered as SKILL.md files.
 */
const KIMI_COMMAND_SKILL_NAMES = new Set([
  "trellis-start",
  "trellis-continue",
  "trellis-finish-work",
]);

/** Session-boundary commands resolved as Kimi skills (Kimi-private root, so
 *  platform-specific `{{CLI_FLAG}}` / `{{CMD_REF}}` resolution is correct). */
function resolveKimiCommandSkills(): ReturnType<typeof resolveAllAsSkills> {
  const ctx = AI_TOOLS.kimi.templateContext;
  return resolveAllAsSkills(ctx).filter((skill) =>
    KIMI_COMMAND_SKILL_NAMES.has(skill.name),
  );
}

/**
 * The Kimi Code file set — written at init and diffed by `trellis update`.
 */
export function collectKimiTemplates(): Map<string, string> {
  const ctx = AI_TOOLS.kimi.templateContext;
  const files = new Map<string, string>();

  // 1. Workflow + bundled skills → shared `.agents/skills/` (neutral
  //    rendering, byte-identical to Codex/Gemini/Pi writes).
  for (const [filePath, content] of collectSkillTemplates(
    ".agents/skills",
    resolveSkillsNeutral(ctx),
    resolveBundledSkills(ctx),
  )) {
    files.set(filePath, content);
  }
  for (const [filePath, content] of collectSkillTemplates(".kimi-code/skills", [
    ...resolveKimiCommandSkills(),
  ])) {
    files.set(filePath, content);
  }

  return files;
}
