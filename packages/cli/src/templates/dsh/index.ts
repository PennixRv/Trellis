/** Main-session platform assets and native context entry points. */

import { createTemplateReader } from "../template-utils.js";

const { readTemplate } = createTemplateReader(import.meta.url);

/** Operator guide copied to `.dsh/DSH.md`. */
export function getDshGuide(): string {
  return readTemplate("DSH.md");
}
