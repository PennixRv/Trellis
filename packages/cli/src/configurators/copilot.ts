import { AI_TOOLS } from "../types/ai-tools.js";
import {
  COPILOT_INSTRUCTIONS_PATH,
  getAllHooks,
  getCopilotInstructions,
  getHooksConfig,
} from "../templates/copilot/index.js";
import {
  resolvePlaceholders,
  resolveCommands,
  resolveSkills,
  resolveBundledSkills,
  collectSkillTemplates,
  collectSharedHooks,
} from "./shared.js";

/** Main-session platform assets and native context entry points. */
export function collectCopilotTemplates(): Map<string, string> {
  const ctx = AI_TOOLS.copilot.templateContext;
  const files = new Map<string, string>();
  for (const cmd of resolveCommands(ctx)) {
    files.set(`.github/prompts/${cmd.name}.prompt.md`, cmd.content);
  }
  for (const [filePath, content] of collectSkillTemplates(
    ".github/skills",
    resolveSkills(ctx),
    resolveBundledSkills(ctx),
  )) {
    files.set(filePath, content);
  }
  // Copilot's own session-start hook
  for (const hook of getAllHooks()) {
    files.set(`.github/copilot/hooks/${hook.name}`, hook.content);
  }
  // Shared hooks (inject-workflow-state.py only). Copilot bundles its own

  for (const [k, v] of collectSharedHooks(".github/copilot/hooks", "copilot")) {
    files.set(k, v);
  }
  files.set(COPILOT_INSTRUCTIONS_PATH, getCopilotInstructions());
  const hooksConfig = resolvePlaceholders(getHooksConfig());
  files.set(".github/copilot/hooks.json", hooksConfig);
  files.set(".github/hooks/trellis.json", hooksConfig);
  return files;
}
