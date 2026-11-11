/** Main-session platform assets and native context entry points. */

import { createTemplateReader, type HookTemplate } from "../template-utils.js";

export type { HookTemplate };

const { getSettings } = createTemplateReader(import.meta.url);

/** Hook configuration written to `.zcode/config.json` (workspace config form). */
export function getHooksConfig(): HookTemplate {
  return getSettings("config.json");
}
