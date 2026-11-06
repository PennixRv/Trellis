export const TASK_PHASE_IDS = [
  "goal_exploration_and_requirements",
  "decision_space_construction_and_merging",
  "solution_design_and_convergence",
  "task_implementation",
  "delivery_review_and_closeout",
] as const;

export type TaskPhaseId = (typeof TASK_PHASE_IDS)[number];

export function isTaskPhaseId(value: unknown): value is TaskPhaseId {
  return (
    typeof value === "string" && TASK_PHASE_IDS.includes(value as TaskPhaseId)
  );
}

export type TaskKind = "analysis" | "implementation" | "combined";
export type TaskComplexity = "simple" | "standard" | "complex";
export type ProjectContext = "new" | "existing";

export type TaskPhaseStatus =
  | "not_started"
  | "active"
  | "waiting_user"
  | "blocked"
  | "accepted"
  | "skipped";

export interface TaskPhaseAcceptance {
  artifact_revision: string;
  result_revision: string;
  input_revision: string;
  task_route_revision: string;
  evidence_refs: string[];
  child_dispositions?: Record<
    string,
    "integrated" | "continue" | "independent" | "cancelled"
  >;
}

export interface TaskPhaseRecord {
  status: TaskPhaseStatus;
  input_revision: string;
  artifact_revision: string;
  result_revision: string;
  artifact_refs: string[];
  result_ref: string | null;
  outcome_kind: string | null;
  reason: string | null;
  evidence_refs: string[];
  acceptance: TaskPhaseAcceptance | null;
}

export interface TaskPhaseSkipRecord {
  reason: string;
  evidence_refs: string[];
  task_route_revision: string;
  input_revision: string;
  artifact_revision: string;
}

export interface TaskPhaseReturnRecord {
  from: TaskPhaseId;
  to: TaskPhaseId;
  reason: string;
  evidence_refs: string[];
  task_route_revision: string;
  return_kind?: "contract_change" | "execution_rework" | "withdrawal";
  authorization_retained?: boolean;
}

/** Current workflow facts stored under task.json.meta.task_workflow. */
export interface TaskWorkflowState {
  schema_version: 1;
  task_route_revision: string;
  task_kind: TaskKind;
  complexity: TaskComplexity;
  project_context: ProjectContext;
  phase_ids: TaskPhaseId[];
  current_phase_id: TaskPhaseId | null;
  input_revision: string;
  phases: Partial<Record<TaskPhaseId, TaskPhaseRecord>>;
  route_dependency_admission?: {
    task_route_revision: string;
    dependencies: string[];
    admission_state: "ready" | "missing" | "stale" | "incompatible" | "blocked";
    evidence_refs: string[];
  } | null;
  implementation_authorization: {
    contract_ref: string;
    contract_revision: string;
    approval_ref: string;
    task_route_revision: string;
  } | null;
  closeout_disposition: "delivery_ready" | "no_go" | "cancelled" | null;
  skip_records: Partial<Record<TaskPhaseId, TaskPhaseSkipRecord>>;
  return_record: TaskPhaseReturnRecord | null;
}

/** Validate the stable task-workflow fields before a consumer relies on them. */
export function parseTaskWorkflowState(value: unknown): TaskWorkflowState {
  if (!isRecord(value)) {
    throw new Error("task_workflow must be an object");
  }
  const state = value;
  if (state.schema_version !== 1)
    throw new Error("task_workflow.schema_version must be 1");
  if (
    !["analysis", "implementation", "combined"].includes(
      String(state.task_kind),
    ) ||
    !["simple", "standard", "complex"].includes(String(state.complexity)) ||
    !["new", "existing"].includes(String(state.project_context))
  ) {
    throw new Error("task_workflow classification is invalid");
  }
  if (
    !isRevision(state.task_route_revision) ||
    !isRevision(state.input_revision)
  ) {
    throw new Error("task_workflow revisions must be positive integer strings");
  }
  if (
    !Array.isArray(state.phase_ids) ||
    state.phase_ids.length === 0 ||
    Array.from(state.phase_ids).some((id) => !isTaskPhaseId(id))
  ) {
    throw new Error(
      "task_workflow.phase_ids must contain declared phase identifiers",
    );
  }
  const phaseIds = Array.from(state.phase_ids) as TaskPhaseId[];
  if (
    new Set(phaseIds).size !== phaseIds.length ||
    phaseIds[0] !== TASK_PHASE_IDS[0] ||
    phaseIds.some((id, index) => {
      const previousId = phaseIds[index - 1];
      return (
        index > 0 &&
        (previousId === undefined ||
          TASK_PHASE_IDS.indexOf(id) <= TASK_PHASE_IDS.indexOf(previousId))
      );
    })
  ) {
    throw new Error(
      "task_workflow.phase_ids must be unique, ordered, and begin with Goal Exploration and Requirements Confirmation Phase",
    );
  }
  if (phaseIds[phaseIds.length - 1] !== TASK_PHASE_IDS[4]) {
    throw new Error(
      "task_workflow.phase_ids must end with Delivery Review and On-Site Closeout Phase",
    );
  }
  if (state.task_kind === "analysis" && phaseIds.includes(TASK_PHASE_IDS[3])) {
    throw new Error(
      "analysis tasks cannot include the Task Implementation and Test Verification Phase",
    );
  }
  if (
    state.current_phase_id !== null &&
    (!isTaskPhaseId(state.current_phase_id) ||
      !phaseIds.includes(state.current_phase_id))
  ) {
    throw new Error(
      "task_workflow.current_phase_id must be in phase_ids or null",
    );
  }
  if (!isRecord(state.phases)) {
    throw new Error("task_workflow.phases must be an object");
  }
  const phases = state.phases;
  for (const phaseId of phaseIds) {
    const phase = phases[phaseId];
    if (!isRecord(phase)) {
      throw new Error(`task_workflow.phases.${phaseId} must be an object`);
    }
    const record = phase;
    if (
      ![
        "not_started",
        "active",
        "waiting_user",
        "blocked",
        "accepted",
        "skipped",
      ].includes(String(record.status)) ||
      !isRevision(record.input_revision) ||
      typeof record.artifact_revision !== "string" ||
      !/^[a-f0-9]{64}$/i.test(record.artifact_revision) ||
      !isRevision(record.result_revision, true) ||
      !isStringArray(record.artifact_refs) ||
      !isStringArray(record.evidence_refs) ||
      !(record.result_ref === null || typeof record.result_ref === "string") ||
      !(
        record.outcome_kind === null || typeof record.outcome_kind === "string"
      ) ||
      !(record.reason === null || typeof record.reason === "string")
    ) {
      throw new Error(`task_workflow.phases.${phaseId} is invalid`);
    }
    if (record.acceptance !== null)
      validateAcceptance(record.acceptance, phaseId);
    if (
      phaseId === TASK_PHASE_IDS[0] &&
      record.status === "accepted" &&
      (!isRecord(record.acceptance) ||
        record.acceptance.artifact_revision !== record.artifact_revision ||
        !Array.isArray(record.acceptance.evidence_refs) ||
        record.acceptance.evidence_refs.length === 0)
    ) {
      throw new Error(
        "accepted Goal Exploration and Requirements Confirmation Phase must retain confirmation for its current artifact revision",
      );
    }
  }
  if (!isRecord(state.skip_records)) {
    throw new Error("task_workflow.skip_records must be an object");
  }
  for (const [phaseId, skip] of Object.entries(state.skip_records)) {
    const phase = isTaskPhaseId(phaseId) ? phases[phaseId] : undefined;
    const phaseStatus = isRecord(phase) ? phase.status : undefined;
    if (
      !isTaskPhaseId(phaseId) ||
      (phaseIds.includes(phaseId) && phaseStatus !== "skipped") ||
      !isRecord(skip) ||
      typeof skip.reason !== "string" ||
      !isStringArray(skip.evidence_refs) ||
      skip.evidence_refs.length === 0 ||
      skip.task_route_revision !== state.task_route_revision ||
      !isRevision(skip.input_revision) ||
      typeof skip.artifact_revision !== "string" ||
      !/^[a-f0-9]{64}$/.test(skip.artifact_revision) ||
      (phase !== undefined &&
        skip.artifact_revision !==
          (isRecord(phase) ? phase.artifact_revision : undefined))
    ) {
      throw new Error(`task_workflow.skip_records.${phaseId} is invalid`);
    }
  }
  if (state.route_dependency_admission != null) {
    const admission = state.route_dependency_admission;
    if (
      !isRecord(admission) ||
      !isRevision(admission.task_route_revision) ||
      !isStringArray(admission.dependencies) ||
      admission.dependencies.length === 0 ||
      admission.dependencies.some((ref) => !ref.trim()) ||
      new Set(admission.dependencies).size !== admission.dependencies.length ||
      !["ready", "missing", "stale", "incompatible", "blocked"].includes(
        String(admission.admission_state),
      ) ||
      !isStringArray(admission.evidence_refs) ||
      admission.evidence_refs.some((ref) => !ref.trim()) ||
      new Set(admission.evidence_refs).size !== admission.evidence_refs.length
    ) {
      throw new Error("task_workflow.route_dependency_admission is invalid");
    }
  }
  if (state.implementation_authorization !== null) {
    const authorization = state.implementation_authorization;
    if (
      !isRecord(authorization) ||
      typeof authorization.contract_ref !== "string" ||
      !authorization.contract_ref.trim() ||
      typeof authorization.contract_revision !== "string" ||
      !/^[a-f0-9]{64}$/i.test(authorization.contract_revision) ||
      typeof authorization.approval_ref !== "string" ||
      !authorization.approval_ref.trim() ||
      authorization.task_route_revision !== state.task_route_revision
    ) {
      throw new Error("task_workflow.implementation_authorization is invalid");
    }
  }
  if (
    ![null, "delivery_ready", "no_go", "cancelled"].includes(
      state.closeout_disposition as string | null,
    )
  ) {
    throw new Error("task_workflow.closeout_disposition is invalid");
  }
  if (state.return_record !== null) {
    const returned = state.return_record;
    if (
      !isRecord(returned) ||
      !isTaskPhaseId(returned.from) ||
      !isTaskPhaseId(returned.to) ||
      typeof returned.reason !== "string" ||
      !isStringArray(returned.evidence_refs) ||
      returned.evidence_refs.length === 0 ||
      returned.task_route_revision !== state.task_route_revision
    ) {
      throw new Error("task_workflow.return_record is invalid");
    }
    if (
      returned.return_kind !== undefined &&
      (!["contract_change", "execution_rework", "withdrawal"].includes(
        returned.return_kind as string,
      ) ||
        (returned.return_kind === "withdrawal"
          ? returned.authorization_retained === true
          : returned.authorization_retained !==
            (returned.return_kind === "execution_rework")) ||
        (returned.return_kind === "execution_rework" &&
          (!TASK_PHASE_IDS.slice(3).includes(returned.from) ||
            !TASK_PHASE_IDS.slice(3).includes(returned.to))))
    ) {
      throw new Error(
        "task_workflow.return_record rework semantics are invalid",
      );
    }
  }
  return state as unknown as TaskWorkflowState;
}

function validateAcceptance(value: unknown, phaseId: TaskPhaseId): void {
  if (
    !isRecord(value) ||
    typeof value.artifact_revision !== "string" ||
    !/^[a-f0-9]{64}$/i.test(value.artifact_revision) ||
    !isRevision(value.result_revision) ||
    !isRevision(value.input_revision) ||
    !isRevision(value.task_route_revision) ||
    !isStringArray(value.evidence_refs) ||
    value.evidence_refs.length === 0 ||
    (value.child_dispositions !== undefined &&
      (!isRecord(value.child_dispositions) ||
        Object.entries(value.child_dispositions).some(
          ([id, disposition]) =>
            !id.trim() ||
            !["integrated", "continue", "independent", "cancelled"].includes(
              String(disposition),
            ),
        )))
  ) {
    throw new Error(`task_workflow.phases.${phaseId}.acceptance is invalid`);
  }
}

function isRevision(value: unknown, allowZero = false): value is string {
  return (
    typeof value === "string" &&
    (allowZero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(value)
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
