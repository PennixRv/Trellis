/** Main-session platform assets and native context entry points. */

import { AI_TOOLS } from "../types/ai-tools.js";
import {
  collectSkillTemplates,
  resolveBundledSkills,
  resolveCommands,
  resolveSkills,
} from "./shared.js";

/**
 * The Grok Build file set — written at init and diffed by `trellis update`.
 */
export function collectGrokTemplates(): Map<string, string> {
  const config = AI_TOOLS.grok;
  const ctx = config.templateContext;
  const files = new Map<string, string>();

  // 1. Workflow + bundled skills → .grok/skills/
  for (const [filePath, content] of collectSkillTemplates(
    ".grok/skills",
    resolveSkills(ctx),
    resolveBundledSkills(ctx),
  )) {
    files.set(filePath, content);
  }

  // 2. Commands → flat .grok/commands/trellis-<name>.md
  //    Grok discovers slash commands as flat *.md under commands/ (stem = name).
  for (const cmd of resolveCommands(ctx)) {
    files.set(`.grok/commands/trellis-${cmd.name}.md`, cmd.content);
  }

  return files;
}
