/** Main-session platform assets and native context entry points. */

import { AI_TOOLS } from "../types/ai-tools.js";
import {
  collectSkillTemplates,
  resolveAllAsSkills,
  resolveBundledSkills,
} from "./shared.js";

/**
 * The Reasonix file set — written at init and diffed by `trellis update`.
 */
export function collectReasonixTemplates(): Map<string, string> {
  const config = AI_TOOLS.reasonix;
  const ctx = config.templateContext;
  const files = new Map<string, string>();

  // Workflow skills filtered to avoid collision with subagent skills.
  const skills = resolveAllAsSkills(ctx);

  for (const [filePath, content] of collectSkillTemplates(
    ".reasonix/skills",
    skills,
    resolveBundledSkills(ctx),
  )) {
    files.set(filePath, content);
  }

  return files;
}
