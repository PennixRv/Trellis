import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import {
  resolvePlaceholders,
  wrapWithCommandFrontmatter,
  collectBothTemplates,
  collectSharedHooks,
} from "./shared.js";
import { getSettingsTemplate } from "../templates/trae/index.js";

/** Main-session platform assets and native context entry points. */
export function collectTraeTemplates(): Map<string, string> {
  const files = collectBothTemplates(
    AI_TOOLS.trae.templateContext,
    (n) => `.trae/commands/trellis-${n}.md`,
    ".trae/skills",
    (filePath, content) => {
      const name = path.basename(filePath, ".md");
      return wrapWithCommandFrontmatter(name, content);
    },
  );
  for (const [k, v] of collectSharedHooks(".trae/hooks", "trae")) {
    files.set(k, v);
  }
  const settings = getSettingsTemplate();
  files.set(
    `.trae/${settings.targetPath}`,
    resolvePlaceholders(settings.content),
  );
  return files;
}
