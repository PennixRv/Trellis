import { AI_TOOLS } from "../types/ai-tools.js";
import {
  resolvePlaceholders,
  resolveCommands,
  resolveSkillsNeutral,
  resolveBundledSkills,
  collectSkillTemplates,
  collectSharedHooks,
} from "./shared.js";
import { getSettingsTemplate } from "../templates/gemini/index.js";

/** Main-session platform assets and native context entry points. */
export function collectGeminiTemplates(): Map<string, string> {
  const ctx = AI_TOOLS.gemini.templateContext;
  const files = new Map<string, string>();
  for (const cmd of resolveCommands(ctx)) {
    const toml = `description = "Trellis: ${cmd.name}"\n\nprompt = """\n${cmd.content}\n"""\n`;
    files.set(`.gemini/commands/trellis/${cmd.name}.toml`, toml);
  }
  for (const [filePath, content] of collectSkillTemplates(
    ".agents/skills",
    resolveSkillsNeutral(ctx),
    resolveBundledSkills(ctx),
  )) {
    files.set(filePath, content);
  }
  for (const [k, v] of collectSharedHooks(".gemini/hooks", "gemini")) {
    files.set(k, v);
  }
  files.set(
    ".gemini/settings.json",
    resolvePlaceholders(getSettingsTemplate()),
  );
  return files;
}
