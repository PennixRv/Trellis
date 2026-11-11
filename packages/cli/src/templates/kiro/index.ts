/** Main-session platform assets and native context entry points. */

import { createTemplateReader, type AgentTemplate } from "../template-utils.js";
export type { AgentTemplate };

const { listFiles, readTemplate, listJsonAgents } = createTemplateReader(
  import.meta.url,
);

/**
 * Get all Kiro agent templates (JSON format).
 * Content contains {{PYTHON_CMD}} placeholder that must be resolved before writing.
 */
export const getAllAgents = (): AgentTemplate[] => listJsonAgents();

export interface IdeHookTemplate {
  /** Filename (e.g. "trellis-workflow-state.kiro.hook") */
  name: string;
  /** Raw JSON content; contains {{PYTHON_CMD}} placeholder. */
  content: string;
}

/**
 * Get all Kiro IDE hook templates (`*.kiro.hook` JSON files).
 * Content contains {{PYTHON_CMD}} placeholder that must be resolved before writing.
 */
export const getIdeHooks = (): IdeHookTemplate[] =>
  listFiles("hooks")
    .filter((f) => f.endsWith(".kiro.hook"))
    .map((f) => ({ name: f, content: readTemplate(`hooks/${f}`) }));
