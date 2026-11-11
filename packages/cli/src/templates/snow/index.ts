/** Main-session platform assets and native context entry points. */

import { createTemplateReader, type HookTemplate } from "../template-utils.js";

const { readTemplate, listFiles } = createTemplateReader(import.meta.url);

/** Inject + breadcrumb hooks (onSessionStart / onUserMessage / beforeSubAgentStart). */
export function getAllHooks(): HookTemplate[] {
  return listFiles("hooks").map((name) => ({
    targetPath: name,
    content: readTemplate(`hooks/${name}`),
  }));
}

/** Operator guide copied to `.snow/SNOW.md`. */
export function getSnowGuide(): string {
  return readTemplate("SNOW.md");
}
