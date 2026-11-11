import { AI_TOOLS } from "../types/ai-tools.js";
import {
  resolvePlaceholders,
  resolveAllAsSkills,
  resolveBundledSkills,
  collectSkillTemplates,
  collectSharedHooks,
} from "./shared.js";
import { getAllAgents, getIdeHooks } from "../templates/kiro/index.js";

/** Main-session platform assets and native context entry points. */
export function collectKiroTemplates(): Map<string, string> {
  const files = new Map<string, string>();
  const ctx = AI_TOOLS.kiro.templateContext;
  for (const [filePath, content] of collectSkillTemplates(
    ".kiro/skills",
    resolveAllAsSkills(ctx),
    resolveBundledSkills(ctx),
  )) {
    files.set(filePath, content);
  }
  for (const agent of getAllAgents()) {
    files.set(
      `.kiro/agents/${agent.name}.json`,
      resolvePlaceholders(agent.content),
    );
  }
  for (const [k, v] of collectSharedHooks(".kiro/hooks", "kiro")) {
    files.set(k, v);
  }
  for (const hook of getIdeHooks()) {
    files.set(`.kiro/hooks/${hook.name}`, resolvePlaceholders(hook.content));
  }
  return files;
}
