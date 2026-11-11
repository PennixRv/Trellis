/** Main-session platform assets and native context entry points. */

import { AI_TOOLS } from "../types/ai-tools.js";
import { getAllHooks, getSnowGuide } from "../templates/snow/index.js";
import {
  collectSkillTemplates,
  resolveAllAsSkills,
  resolveBundledSkills,
  resolveCommands,
  replacePythonCommandLiterals,
} from "./shared.js";

function buildSnowCommandJson(name: string, content: string): string {
  const description =
    name === "continue"
      ? "Resume the current Trellis task at the right workflow phase."
      : name === "finish-work"
        ? "Record progress in the developer session journal."
        : `Trellis: ${name}`;

  return (
    JSON.stringify(
      {
        type: "prompt",
        description,
        command: content,
        location: "project",
      },
      null,
      2,
    ) + "\n"
  );
}

function collectSnowStaticFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const hook of getAllHooks()) {
    files.set(`.snow/hooks/${hook.targetPath}`, hook.content);
  }
  files.set(".snow/SNOW.md", getSnowGuide());
  return files;
}

/**
 * The Snow CLI file set — written at init and diffed by `trellis update`.
 */
export function collectSnowTemplates(): Map<string, string> {
  const config = AI_TOOLS.snow;
  const ctx = config.templateContext;
  const files = new Map<string, string>();

  // hasHooks=true → resolveAllAsSkills drops trellis-start.
  for (const [filePath, content] of collectSkillTemplates(
    ".snow/skills",
    resolveAllAsSkills(ctx),
    resolveBundledSkills(ctx),
  )) {
    files.set(filePath, content);
  }

  for (const cmd of resolveCommands(ctx)) {
    const body = replacePythonCommandLiterals(cmd.content);
    files.set(
      `.snow/commands/trellis-${cmd.name}.json`,
      buildSnowCommandJson(cmd.name, body),
    );
  }

  for (const [filePath, content] of collectSnowStaticFiles()) {
    files.set(filePath, content);
  }

  return files;
}
