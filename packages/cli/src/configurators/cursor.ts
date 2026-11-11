import { AI_TOOLS } from "../types/ai-tools.js";
import {
  resolvePlaceholders,
  collectBothTemplates,
  collectSharedHooks,
} from "./shared.js";
import { getHooksConfig } from "../templates/cursor/index.js";

/** Main-session platform assets and native context entry points. */
export function collectCursorTemplates(): Map<string, string> {
  const files = collectBothTemplates(
    AI_TOOLS.cursor.templateContext,
    (n) => `.cursor/commands/trellis-${n}.md`,
    ".cursor/skills",
  );
  for (const [k, v] of collectSharedHooks(".cursor/hooks", "cursor")) {
    files.set(k, v);
  }
  files.set(".cursor/hooks.json", resolvePlaceholders(getHooksConfig()));
  return files;
}
