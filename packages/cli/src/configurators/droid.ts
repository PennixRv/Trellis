import { AI_TOOLS } from "../types/ai-tools.js";
import {
  resolvePlaceholders,
  collectBothTemplates,
  collectSharedHooks,
} from "./shared.js";
import { getSettingsTemplate } from "../templates/droid/index.js";

/** Main-session platform assets and native context entry points. */
export function collectDroidTemplates(): Map<string, string> {
  const files = collectBothTemplates(
    AI_TOOLS.droid.templateContext,
    (n) => `.factory/commands/trellis/${n}.md`,
    ".factory/skills",
  );
  for (const [k, v] of collectSharedHooks(".factory/hooks", "droid")) {
    files.set(k, v);
  }
  const settings = getSettingsTemplate();
  files.set(
    `.factory/${settings.targetPath}`,
    resolvePlaceholders(settings.content),
  );
  return files;
}
