import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import {
  resolvePlaceholders,
  wrapWithCommandFrontmatter,
  collectBothTemplates,
  collectSharedHooks,
} from "./shared.js";
import { getSettingsTemplate } from "../templates/qoder/index.js";

/** Main-session platform assets and native context entry points. */
export function collectQoderTemplates(): Map<string, string> {
  const files = collectBothTemplates(
    AI_TOOLS.qoder.templateContext,
    (n) => `.qoder/commands/trellis-${n}.md`,
    ".qoder/skills",
    (filePath, content) => {
      const name = path.basename(filePath, ".md");
      return wrapWithCommandFrontmatter(name, content);
    },
  );
  for (const [k, v] of collectSharedHooks(".qoder/hooks", "qoder")) {
    files.set(k, v);
  }
  const settings = getSettingsTemplate();
  files.set(
    `.qoder/${settings.targetPath}`,
    resolvePlaceholders(settings.content),
  );
  return files;
}
