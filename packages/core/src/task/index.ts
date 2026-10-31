// Public task API surface — canonical task record shape, factory,
// schema, I/O helpers, directory validation, and phase inference.
//
// Task API is intentionally independent from the Teamwork API.

export type {
  TrellisTaskRecord,
  TaskRecordField,
} from "./schema.js";

export {
  TASK_RECORD_FIELD_ORDER,
  emptyTaskRecord,
  taskRecordSchema,
} from "./schema.js";

export type {
  LoadTaskRecordOptions,
  WriteTaskRecordOptions,
} from "./records.js";

export {
  loadTaskRecord,
  writeTaskRecord,
} from "./records.js";

export type { TaskDirParts } from "./paths.js";
export { validateTaskDirName, isValidTaskDirName } from "./paths.js";

export type {
  ProjectContext,
  TaskComplexity,
  TaskKind,
  TaskPhaseAcceptance,
  TaskPhaseId,
  TaskPhaseRecord,
  TaskPhaseReturnRecord,
  TaskPhaseSkipRecord,
  TaskPhaseStatus,
  TaskWorkflowState,
} from "./phase.js";
export { isTaskPhaseId, parseTaskWorkflowState, TASK_PHASE_IDS } from "./phase.js";
