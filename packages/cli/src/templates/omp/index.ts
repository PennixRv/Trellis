import { createTemplateReader } from "../template-utils.js";

const { readTemplate } = createTemplateReader(import.meta.url);

export function getExtensionTemplate(): string {
  return readTemplate("extensions/trellis/index.ts.txt");
}
