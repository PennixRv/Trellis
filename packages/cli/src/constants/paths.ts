/**
 * Path constants for Trellis workflow structure
 *
 * Change these values to rename directories across the entire project.
 * All paths should be relative to the project root.
 */

// Directory names (can be renamed)
export const DIR_NAMES = {
  /** Root workflow directory */
  WORKFLOW: ".trellis",
  /** Workspace directory (under .trellis/) - developer work areas */
  WORKSPACE: "workspace",
  /** Tasks directory (under .trellis/) - unified task storage */
  TASKS: "tasks",
  /** Spec/guidelines directory (under .trellis/) */
  SPEC: "spec",
  /** Scripts directory (under .trellis/) */
  SCRIPTS: "scripts",
  /** Teamwork runtime agent definitions (under .trellis/) */
  AGENTS: "agents",
} as const;

// File names
export const FILE_NAMES = {
  /** Root agent instructions file */
  AGENTS: "AGENTS.md",
  /** Developer identity file */
  DEVELOPER: ".developer",
  /** Current task pointer */
  CURRENT_TASK: ".current-task",
  /** Task metadata */
  TASK_JSON: "task.json",
  /** Requirements document */
  PRD: "prd.md",
  /** Workflow guide */
  WORKFLOW_GUIDE: "workflow.md",
  /** Journal file prefix */
  JOURNAL_PREFIX: "journal-",
} as const;

// Constructed paths (relative to project root)
export const PATHS = {
  /** .trellis/ */
  WORKFLOW: DIR_NAMES.WORKFLOW,
  /** .trellis/workspace/ */
  WORKSPACE: `${DIR_NAMES.WORKFLOW}/${DIR_NAMES.WORKSPACE}`,
  /** .trellis/tasks/ */
  TASKS: `${DIR_NAMES.WORKFLOW}/${DIR_NAMES.TASKS}`,
  /** .trellis/spec/ */
  SPEC: `${DIR_NAMES.WORKFLOW}/${DIR_NAMES.SPEC}`,
  /** .trellis/scripts/ */
  SCRIPTS: `${DIR_NAMES.WORKFLOW}/${DIR_NAMES.SCRIPTS}`,
  /** .trellis/agents/ */
  AGENTS: `${DIR_NAMES.WORKFLOW}/${DIR_NAMES.AGENTS}`,
  /** .trellis/.developer */
  DEVELOPER_FILE: `${DIR_NAMES.WORKFLOW}/${FILE_NAMES.DEVELOPER}`,
  /** .trellis/.current-task */
  CURRENT_TASK_FILE: `${DIR_NAMES.WORKFLOW}/${FILE_NAMES.CURRENT_TASK}`,
  /** .trellis/workflow.md */
  WORKFLOW_GUIDE_FILE: `${DIR_NAMES.WORKFLOW}/${FILE_NAMES.WORKFLOW_GUIDE}`,
} as const;

/**
 * Get developer's workspace directory path
 * @example getWorkspaceDir("john") => ".trellis/workspace/john"
 */
export function getWorkspaceDir(developer: string): string {
  return `${PATHS.WORKSPACE}/${developer}`;
}

/**
 * Join an explicit path relative to the task storage root.
 * @example getTaskDir("planning/01-21-my-task") => ".trellis/tasks/planning/01-21-my-task"
 */
export function getTaskDir(taskPath: string): string {
  return `${PATHS.TASKS}/${taskPath}`;
}
