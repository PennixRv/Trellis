import { AI_TOOLS } from "../types/ai-tools.js";
import {
  resolvePlaceholders,
  collectBothTemplates,
  collectSharedHooks,
} from "./shared.js";
import { getSettingsTemplate } from "../templates/codebuddy/index.js";

/** Main-session platform assets and native context entry points. */
export function collectCodebuddyTemplates(): Map<string, string> {
  const files = collectBothTemplates(
    AI_TOOLS.codebuddy.templateContext,
    (n) => `.codebuddy/commands/trellis/${n}.md`,
    ".codebuddy/skills",
  );
  for (const [k, v] of collectSharedHooks(".codebuddy/hooks", "codebuddy")) {
    files.set(k, v);
  }
  const settings = getSettingsTemplate();
  files.set(
    `.codebuddy/${settings.targetPath}`,
    resolvePlaceholders(settings.content),
  );
  return files;
}
