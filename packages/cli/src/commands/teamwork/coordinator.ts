import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  isTaskPhaseId,
  parseTaskWorkflowState,
} from "@pennixrv/trellis-core/task";
import {
  assertCoordinationTransition,
  readTeamworkEvents,
  readCoordinationState,
  recordCoordinationEvent,
  type CoordinationState,
} from "@pennixrv/trellis-core/teamwork";

import {
  type TeamworkPlan,
  TeammateReportReadError,
  readTeammateReport,
  writeTeammateQueueFact,
  writeTeammateClaim,
  writeTeammateDisposition,
  validateTeamworkPlan,
} from "./artifact.js";
import {
  assertTeammateAdapterContract,
  assertTeammateHostCapability,
  type TeammateHostCapabilities,
} from "./teammate-adapters.js";
import {
  effectiveTeammateCapacity,
  resolveTeammateRuntimeConfig,
  type TeammateRuntimeConfig,
} from "./teammate-config.js";
import type { resolveTeammateProfile } from "./profiles.js";
import { type TeammateLaunchSpec } from "./teammate-launch.js";
import { readProcessIdentity } from "./process-identity.js";
import { withLock } from "./store/lock.js";

export type AttemptWaitResult =
  | { kind: "report"; terminal: true; providerSessionId?: string }
  | { kind: "timeout"; reason?: string; providerSessionId?: string }
  | {
      kind: "failed";
      reason: string;
      terminal: true;
      providerSessionId?: string;
    }
  | {
      kind: "cancelled";
      reason?: string;
      terminal: true;
      providerSessionId?: string;
    }
  | { kind: "reconciliation"; reason: string; providerSessionId?: string };

export interface TeammateDispatchContext {
  plan: TeamworkPlan;
  assignment: TeamworkPlan["assignments"][number];
  attemptId: string;
  teammateId: string;
  retryCount: number;
  providerSessionId?: string;
  profile: ReturnType<typeof resolveTeammateProfile>;
  launch: TeammateLaunchSpec;
}

export interface TeammateGuard {
  acquire(input: {
    batchId: string;
    planHash: string;
    capacity: number;
  }): Promise<void>;
  release(input: {
    batchId: string;
    planHash: string;
    capacity: number;
  }): Promise<void>;
}

export interface CoordinatorRuntime {
  prepare?(context: TeammateDispatchContext): void;
  dispatch(
    context: TeammateDispatchContext,
  ): Promise<undefined | { providerSessionId?: string }>;
  wait(context: TeammateDispatchContext): Promise<AttemptWaitResult>;
  continue(context: TeammateDispatchContext): Promise<AttemptWaitResult>;
  cancel?(context: TeammateDispatchContext): Promise<AttemptWaitResult>;
}

export interface TeamworkCoordinatorInput {
  plan: unknown;
  taskRoot: string;
  cwd?: string;
  by?: string;
  host: TeammateHostCapabilities;
  runtime: CoordinatorRuntime;
  guard: TeammateGuard;
  config?: TeammateRuntimeConfig;
}

export class TeamworkPolicyChangedError extends Error {}

export interface TeamworkReceipt {
  schemaVersion: 1;
  batchId: string;
  status:
    | "AWAITING_REVIEW"
    | "ALL_ACCEPTED"
    | "SETTLED_WITH_FAILURE"
    | "RECONCILIATION_REQUIRED";
  assignments: {
    assignmentId: string;
    status: "AWAITING_REVIEW" | "ACCEPTED" | "FINAL_FAILED" | "UNKNOWN";
  }[];
  capacity: number;
  retryCounts: Record<string, number>;
  evaluationGroups?: {
    id: string;
    status: "COMPLETE" | "INCOMPLETE";
  }[];
}

export function assertTeamworkPlanCurrent(
  plan: Pick<
    TeamworkPlan,
    "taskId" | "phaseId" | "taskRouteRevision" | "inputRevision"
  >,
  taskRoot: string,
): void {
  const taskFile = path.join(taskRoot, "task.json");
  const stat = fs.lstatSync(taskFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) {
    throw new Error("task.json must be a regular file under 2097152 bytes");
  }
  const task = JSON.parse(fs.readFileSync(taskFile, "utf8")) as unknown;
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    throw new Error("task.json must be an object");
  }
  const record = task as Record<string, unknown>;
  if (
    record.id !== plan.taskId ||
    !record.meta ||
    typeof record.meta !== "object" ||
    Array.isArray(record.meta)
  ) {
    throw new Error("Teamwork plan task_id does not match task.json");
  }
  const meta = record.meta as Record<string, unknown>;
  const workflow = parseTaskWorkflowState(meta.task_workflow);
  if (!isTaskPhaseId(plan.phaseId)) {
    throw new Error("Teamwork plan phase_id is not a declared task phase");
  }
  const phase = workflow.phases[plan.phaseId];
  if (
    workflow.current_phase_id !== plan.phaseId ||
    workflow.task_route_revision !== plan.taskRouteRevision ||
    phase?.status !== "active" ||
    phase.input_revision !== plan.inputRevision
  ) {
    throw new Error(
      "Teamwork plan does not match the current active task phase and revisions",
    );
  }
}

function terminalReceiptFromProjection(
  plan: TeamworkPlan,
  projection: Awaited<ReturnType<typeof readCoordinationState>>,
): TeamworkReceipt {
  const mismatch = (reason: string): never => {
    throw new Error(`batch '${plan.batchId}' ${reason}`);
  };
  if (projection.issues.length > 0)
    mismatch("has coordination projection issues");
  const batch = projection.batches.find(
    (entry) => entry.batchId === plan.batchId,
  );
  if (!batch) return mismatch("does not match the frozen plan");
  if (batch.planHash !== plan.planHash)
    return mismatch("does not match the frozen plan");
  if (
    !["AWAITING_REVIEW", "ALL_ACCEPTED", "SETTLED_WITH_FAILURE"].includes(
      batch.state,
    )
  )
    mismatch("is not terminal");
  const effectiveCapacity = batch.effectiveCapacity;
  if (
    typeof effectiveCapacity !== "number" ||
    !Number.isSafeInteger(effectiveCapacity) ||
    effectiveCapacity < 1
  )
    return mismatch("has no valid effective capacity");
  if (projection.leases.some((lease) => lease.batchId === plan.batchId))
    mismatch("still owns capacity leases");

  const projectedAssignments = projection.assignments.filter(
    (assignment) => assignment.batchId === plan.batchId,
  );
  if (
    projectedAssignments.length !== plan.assignments.length ||
    new Set(projectedAssignments.map((assignment) => assignment.assignmentId))
      .size !== plan.assignments.length
  )
    mismatch("does not contain the exact frozen assignment set");
  const assignmentById = new Map(
    projectedAssignments.map((assignment) => [
      assignment.assignmentId,
      assignment,
    ]),
  );
  const planAssignmentIds = new Set(
    plan.assignments.map((assignment) => assignment.assignmentId),
  );
  const attempts = projection.attempts.filter(
    (attempt) => attempt.batchId === plan.batchId,
  );
  const teammates = projection.teammates.filter(
    (teammate) => teammate.batchId === plan.batchId,
  );
  if (attempts.length !== teammates.length)
    mismatch("has unmatched provider attempts and teammates");
  for (const attempt of attempts) {
    if (
      !attempt.assignmentId ||
      !planAssignmentIds.has(attempt.assignmentId) ||
      !attempt.teammateId ||
      attempt.terminal !== true ||
      !["REPORT_SUBMITTED", "FAILED", "FINAL_FAILED"].includes(attempt.state)
    )
      mismatch("has an unresolved provider attempt");
    const teammate = teammates.find(
      (entry) =>
        entry.attemptId === attempt.attemptId &&
        entry.teammateId === attempt.teammateId,
    );
    if (
      teammate?.terminal !== true ||
      (teammate?.state !== "REPORT_SUBMITTED" && teammate?.state !== "FAILED")
    )
      mismatch("has an unresolved teammate terminal fact");
  }

  const assignments = plan.assignments.map((assignment) => {
    const projected = assignmentById.get(assignment.assignmentId);
    if (
      !projected ||
      !["AWAITING_REVIEW", "ACCEPTED", "FINAL_FAILED"].includes(projected.state)
    )
      return mismatch(`assignment '${assignment.assignmentId}' is not settled`);
    if (
      projected.state === "ACCEPTED" ||
      projected.state === "AWAITING_REVIEW"
    ) {
      const acceptedAttempt = attempts.find(
        (attempt) =>
          attempt.attemptId === projected.attemptId &&
          attempt.assignmentId === assignment.assignmentId,
      );
      if (acceptedAttempt?.state !== "REPORT_SUBMITTED")
        return mismatch(
          `assignment '${assignment.assignmentId}' has no accepted attempt`,
        );
    }
    return {
      assignmentId: assignment.assignmentId,
      status: projected.state as
        | "AWAITING_REVIEW"
        | "ACCEPTED"
        | "FINAL_FAILED",
    };
  });
  const status = assignments.some((item) => item.status === "AWAITING_REVIEW")
    ? "AWAITING_REVIEW"
    : assignments.every((item) => item.status === "ACCEPTED")
      ? "ALL_ACCEPTED"
      : "SETTLED_WITH_FAILURE";
  if (batch.state !== status)
    mismatch("terminal state disagrees with its assignment dispositions");
  const retryCounts = Object.fromEntries(
    plan.assignments.flatMap((assignment) => {
      const count = assignmentById.get(assignment.assignmentId)?.retryCount;
      if (count === undefined)
        return mismatch(`assignment '${assignment.assignmentId}' is missing`);
      const started = attempts.some(
        (attempt) => attempt.assignmentId === assignment.assignmentId,
      );
      return started || count > 0 ? [[assignment.assignmentId, count]] : [];
    }),
  );
  const evaluationGroups = [
    ...new Set(
      plan.assignments
        .map((assignment) => assignment.evaluationGroup?.id)
        .filter((id): id is string => id !== undefined),
    ),
  ].map((id) => ({
    id,
    status: plan.assignments
      .filter((assignment) => assignment.evaluationGroup?.id === id)
      .every(
        (assignment) =>
          assignmentById.get(assignment.assignmentId)?.state === "ACCEPTED",
      )
      ? ("COMPLETE" as const)
      : ("INCOMPLETE" as const),
  }));
  return {
    schemaVersion: 1,
    batchId: plan.batchId,
    status,
    assignments,
    capacity: effectiveCapacity,
    retryCounts,
    evaluationGroups,
  };
}

function reconciliationReceipt(
  plan: TeamworkPlan,
  projection: Awaited<ReturnType<typeof readCoordinationState>>,
  capacity: number,
): TeamworkReceipt {
  return {
    schemaVersion: 1,
    batchId: plan.batchId,
    status: "RECONCILIATION_REQUIRED",
    assignments: plan.assignments.map((item) => {
      const current = projection.assignments.find(
        (entry) =>
          entry.batchId === plan.batchId &&
          entry.assignmentId === item.assignmentId,
      );
      return {
        assignmentId: item.assignmentId,
        status:
          current?.state === "ACCEPTED" || current?.state === "FINAL_FAILED"
            ? current.state
            : "UNKNOWN",
      };
    }),
    capacity:
      projection.batches.find((entry) => entry.batchId === plan.batchId)
        ?.effectiveCapacity ?? capacity,
    retryCounts: Object.fromEntries(
      projection.assignments
        .filter((entry) => entry.batchId === plan.batchId)
        .map((entry) => [entry.assignmentId, entry.retryCount]),
    ),
  };
}

async function recordRecoveryReconciliation(input: {
  plan: TeamworkPlan;
  cwd: string;
  by: string;
  existingState: CoordinationState;
  projection: Awaited<ReturnType<typeof readCoordinationState>>;
  capacity: number;
  reason: string;
}): Promise<TeamworkReceipt> {
  const { plan, cwd, by, existingState, projection, capacity, reason } = input;
  if (
    existingState !== "RECONCILIATION_REQUIRED" &&
    existingState !== "AWAITING_REVIEW" &&
    existingState !== "ALL_ACCEPTED" &&
    existingState !== "SETTLED_WITH_FAILURE"
  ) {
    await appendTransition({
      sessionId: plan.sessionId,
      cwd,
      by,
      batchId: plan.batchId,
      entity: "batch",
      id: plan.batchId,
      state: "RECONCILIATION_REQUIRED",
      states: new Map([[plan.batchId, existingState]]),
      planHash: plan.planHash,
      payload: { recoveredAfterRestart: true },
    });
  }
  const receipt = reconciliationReceipt(plan, projection, capacity);
  await appendAction({
    sessionId: plan.sessionId,
    cwd,
    by,
    batchId: plan.batchId,
    entity: "batch",
    action: "reconciliation_required",
    reason,
  });
  await appendAction({
    sessionId: plan.sessionId,
    cwd,
    by,
    batchId: plan.batchId,
    entity: "batch",
    action: "receipt_recorded",
    id: `${plan.batchId}:RECONCILIATION_REQUIRED`,
    payload: { ...receipt, reason },
  });
  return receipt;
}

async function recoverExistingBatch(input: {
  plan: TeamworkPlan;
  cwd: string;
  by: string;
  capacity: number;
}): Promise<TeamworkReceipt | undefined> {
  const projection = await readCoordinationState({
    sessionId: input.plan.sessionId,
    cwd: input.cwd,
  });
  const existing = projection.batches.find(
    (batch) => batch.batchId === input.plan.batchId,
  );
  if (!existing) return undefined;
  if (existing.planHash !== input.plan.planHash) {
    throw new Error("batch id already exists with a different plan hash");
  }
  const events = await readTeamworkEvents({
    sessionId: input.plan.sessionId,
    cwd: input.cwd,
  });
  if (
    existing.state === "AWAITING_REVIEW" ||
    existing.state === "ALL_ACCEPTED" ||
    existing.state === "SETTLED_WITH_FAILURE"
  ) {
    let receipt: TeamworkReceipt;
    try {
      receipt = terminalReceiptFromProjection(input.plan, projection);
    } catch (error) {
      return recordRecoveryReconciliation({
        ...input,
        existingState: existing.state,
        projection,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    const receipts = events.filter(
      (event) =>
        event.kind === "coordination" &&
        event.batchId === input.plan.batchId &&
        event.action === "receipt_recorded" &&
        event.payload?.status === receipt.status &&
        event.payload?.status !== "RECONCILIATION_REQUIRED",
    );
    if (
      receipts.length > 0 &&
      !isDeepStrictEqual(receipts.at(-1)?.payload, receipt)
    ) {
      return recordRecoveryReconciliation({
        ...input,
        existingState: existing.state,
        projection,
        reason:
          "saved terminal receipt disagrees with durable coordination facts",
      });
    }
    if (receipts.length === 0) {
      await appendAction({
        sessionId: input.plan.sessionId,
        cwd: input.cwd,
        by: input.by,
        batchId: input.plan.batchId,
        entity: "batch",
        action: "receipt_recorded",
        id: `${input.plan.batchId}:${receipt.status}`,
        payload: { ...receipt },
      });
    }
    await assertTeamworkReceiptDurable(input.plan, receipt, input.cwd);
    return receipt;
  }
  return recordRecoveryReconciliation({
    ...input,
    existingState: existing.state,
    projection,
    reason: "recovered nonterminal batch requires reconciliation",
  });
}

interface ActiveAssignment {
  slot: number;
  assignment: TeamworkPlan["assignments"][number];
  retryCount: number;
  continuations: number;
  leaseReleased?: boolean;
  providerSessionId?: string;
  context: TeammateDispatchContext;
}

function transitionState(
  states: Map<string, CoordinationState>,
  key: string,
  next: CoordinationState,
  entity: "batch" | "assignment" | "attempt" | "teammate",
): void {
  assertCoordinationTransition(entity, states.get(key), next);
  states.set(key, next);
}

async function appendTransition(input: {
  sessionId: string;
  cwd?: string;
  by: string;
  batchId: string;
  entity: "batch" | "assignment" | "attempt" | "teammate";
  id: string;
  state: CoordinationState;
  states: Map<string, CoordinationState>;
  assignmentId?: string;
  attemptId?: string;
  teammateId?: string;
  slot?: number;
  retryCount?: number;
  transitionKey?: string;
  providerSessionId?: string;
  terminal?: boolean;
  planHash?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  transitionState(input.states, input.id, input.state, input.entity);
  await recordCoordinationEvent({
    sessionId: input.sessionId,
    ...(input.cwd ? { cwd: input.cwd } : {}),
    by: input.by,
    batchId: input.batchId,
    entity: input.entity,
    action: "state_transition",
    state: input.state,
    ...(input.assignmentId ? { assignmentId: input.assignmentId } : {}),
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    ...(input.teammateId ? { teammateId: input.teammateId } : {}),
    ...(input.slot !== undefined ? { slot: input.slot } : {}),
    ...(input.retryCount !== undefined ? { retryCount: input.retryCount } : {}),
    ...(input.providerSessionId
      ? { providerSessionId: input.providerSessionId }
      : {}),
    ...(input.terminal !== undefined ? { terminal: input.terminal } : {}),
    ...(input.planHash ? { planHash: input.planHash } : {}),
    ...(input.payload ? { payload: input.payload } : {}),
    idempotencyKey: `${input.batchId}:${input.entity}:${input.id}:${input.state}:${input.transitionKey ?? "initial"}`,
  });
}

async function appendAction(input: {
  sessionId: string;
  cwd?: string;
  by: string;
  batchId: string;
  entity: "batch" | "assignment" | "attempt" | "teammate";
  action:
    | "claim_created"
    | "command_issued"
    | "receipt_recorded"
    | "lease_acquired"
    | "lease_released"
    | "reconciliation_required";
  id?: string;
  assignmentId?: string;
  attemptId?: string;
  teammateId?: string;
  leaseId?: string;
  protected?: boolean;
  reason?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await recordCoordinationEvent({
    sessionId: input.sessionId,
    ...(input.cwd ? { cwd: input.cwd } : {}),
    by: input.by,
    batchId: input.batchId,
    entity: input.entity,
    action: input.action,
    ...(input.id && input.action === "claim_created"
      ? { claimId: input.id }
      : {}),
    ...(input.id && input.action === "command_issued"
      ? { commandId: input.id }
      : {}),
    ...(input.id && input.action === "receipt_recorded"
      ? { receiptId: input.id }
      : {}),
    ...(input.assignmentId ? { assignmentId: input.assignmentId } : {}),
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    ...(input.teammateId ? { teammateId: input.teammateId } : {}),
    ...(input.leaseId ? { leaseId: input.leaseId } : {}),
    ...(input.protected !== undefined ? { protected: input.protected } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.payload ? { payload: input.payload } : {}),
    idempotencyKey: `${input.batchId}:${input.action}:${input.id ?? input.leaseId ?? input.attemptId ?? "event"}`,
  });
}

export function readPlanFile(planPath: string): unknown {
  const stat = fs.lstatSync(planPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
    throw new Error("Teamwork plan must be a regular file under 2097152 bytes");
  const raw = fs.readFileSync(planPath, "utf8");
  return JSON.parse(raw) as unknown;
}

export function loadTeamworkPlan(
  planPath: string,
  taskRoot: string,
): TeamworkPlan {
  const plan = validateTeamworkPlan(
    readPlanFile(planPath),
    taskRoot,
    undefined,
    { allowExpired: true },
  );
  assertTeamworkPlanCurrent(plan, taskRoot);
  return plan;
}

export async function runTeamworkCoordinator(
  input: TeamworkCoordinatorInput,
): Promise<TeamworkReceipt> {
  const plan = validateTeamworkPlan(input.plan, input.taskRoot, undefined, {
    allowExpired: true,
  });
  assertTeamworkPlanCurrent(plan, input.taskRoot);
  const cwd = input.cwd ?? input.taskRoot;
  const frozenLaunches = new Map<
    string,
    {
      profile: ReturnType<typeof resolveTeammateProfile>;
      launch: TeammateLaunchSpec;
    }
  >();
  for (const assignment of plan.assignments) {
    assertTeammateAdapterContract(assignment.provider);
    assertTeammateHostCapability(
      assignment.provider,
      input.host,
      assignment.execution.profile.options,
    );
    frozenLaunches.set(assignment.assignmentId, assignment.execution);
  }
  const config =
    input.config ??
    resolveTeammateRuntimeConfig(cwd, process.env, plan.coordinationMode);
  const capacity = effectiveTeammateCapacity({
    requested: plan.requestedCapacity,
    assignmentCount: plan.assignments.length,
    config,
    verifiedHostCap: input.host.verifiedHostCap,
  });
  const by = input.by ?? "main";
  const existing = await readCoordinationState({
    sessionId: plan.sessionId,
    cwd,
  });
  const settled = existing.batches.find(
    (batch) => batch.batchId === plan.batchId,
  );
  if (
    settled &&
    ["AWAITING_REVIEW", "ALL_ACCEPTED", "SETTLED_WITH_FAILURE"].includes(
      settled.state,
    )
  ) {
    let terminal = false;
    try {
      terminalReceiptFromProjection(plan, existing);
      terminal = true;
    } catch {
      // Inconsistent terminal facts still require the protected recovery path.
    }
    if (terminal) {
      const recovered = await recoverExistingBatch({ plan, cwd, by, capacity });
      if (recovered) return recovered;
    }
  }
  const batchStates = new Map<string, CoordinationState>();
  const assignmentStates = new Map<string, CoordinationState>();
  const attemptStates = new Map<string, CoordinationState>();
  const teammateStates = new Map<string, CoordinationState>();
  await input.guard.acquire({
    batchId: plan.batchId,
    planHash: plan.planHash,
    capacity,
  });
  let guardHeld = true;
  // Failed recovery cannot prove that an older provider process exited.
  const recovered = await recoverExistingBatch({ plan, cwd, by, capacity });
  if (recovered) {
    if (recovered.status !== "RECONCILIATION_REQUIRED") {
      await input.guard.release({
        batchId: plan.batchId,
        planHash: plan.planHash,
        capacity,
      });
      guardHeld = false;
    }
    return recovered;
  }
  if (Date.parse(plan.deadline) <= Date.now()) {
    await input.guard.release({
      batchId: plan.batchId,
      planHash: plan.planHash,
      capacity,
    });
    throw new Error("deadline elapsed before batch dispatch");
  }
  try {
    for (const [queueIndex, assignment] of plan.assignments.entries()) {
      writeTeammateQueueFact({
        taskRoot: input.taskRoot,
        briefPath: assignment.briefPath,
        taskId: plan.taskId,
        batchId: plan.batchId,
        assignmentId: assignment.assignmentId,
        planHash: plan.planHash,
        briefDigest: assignment.briefDigest,
        sourceDigest: assignment.sourceDigest,
        queueIndex,
      });
    }
  } catch (error) {
    await input.guard.release({
      batchId: plan.batchId,
      planHash: plan.planHash,
      capacity,
    });
    guardHeld = false;
    throw error;
  }
  await appendTransition({
    sessionId: plan.sessionId,
    by,
    batchId: plan.batchId,
    entity: "batch",
    id: plan.batchId,
    state: "PREPARED",
    states: batchStates,
    planHash: plan.planHash,
    payload: {
      requestedCapacity: plan.requestedCapacity,
      effectiveCapacity: capacity,
      teammateMaxConcurrency: config.teammate.maxConcurrency,
      maxLiveTeammates: config.guard.maxLiveTeammates,
      nonBatchReserved: config.guard.nonBatchReserved,
      verifiedHostCap: input.host.verifiedHostCap,
      ...(config.sourceDigest ? { configDigest: config.sourceDigest } : {}),
    },
  });
  await appendTransition({
    sessionId: plan.sessionId,
    by,
    batchId: plan.batchId,
    entity: "batch",
    id: plan.batchId,
    state: "VALIDATING_PLAN",
    states: batchStates,
    planHash: plan.planHash,
  });
  for (const assignment of plan.assignments) {
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "assignment",
      id: assignment.assignmentId,
      state: "QUEUED",
      states: assignmentStates,
      assignmentId: assignment.assignmentId,
      retryCount: 0,
    });
    await appendAction({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "assignment",
      action: "claim_created",
      id: `${plan.batchId}:assignment:${assignment.assignmentId}`,
      assignmentId: assignment.assignmentId,
    });
  }
  await appendTransition({
    sessionId: plan.sessionId,
    by,
    batchId: plan.batchId,
    entity: "batch",
    id: plan.batchId,
    state: "RUNNING",
    states: batchStates,
    planHash: plan.planHash,
  });

  const pending = [...plan.assignments];
  const active = new Map<number, ActiveAssignment>();
  const waits = new Map<
    number,
    Promise<{ slot: number; result: AttemptWaitResult }>
  >();
  const final = new Map<string, "AWAITING_REVIEW" | "FINAL_FAILED">();
  const retryCounts: Record<string, number> = {};
  let admissionClosed = false;

  async function reconcile(reason: string): Promise<TeamworkReceipt> {
    await appendAction({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "batch",
      action: "reconciliation_required",
      reason,
    });
    if (batchStates.get(plan.batchId) !== "RECONCILIATION_REQUIRED") {
      await appendTransition({
        sessionId: plan.sessionId,
        by,
        batchId: plan.batchId,
        entity: "batch",
        id: plan.batchId,
        state: "RECONCILIATION_REQUIRED",
        states: batchStates,
      });
    }
    const receipt: TeamworkReceipt = {
      schemaVersion: 1,
      batchId: plan.batchId,
      status: "RECONCILIATION_REQUIRED",
      assignments: plan.assignments.map((item) => ({
        assignmentId: item.assignmentId,
        status: final.get(item.assignmentId) ?? "UNKNOWN",
      })),
      capacity,
      retryCounts,
    };
    await appendAction({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "batch",
      action: "receipt_recorded",
      id: `${plan.batchId}:RECONCILIATION_REQUIRED`,
      payload: { ...receipt, reason },
    });
    return receipt;
  }

  async function failPending(reason: string): Promise<void> {
    admissionClosed = true;
    while (pending.length > 0) {
      const assignment = pending.shift();
      if (!assignment) continue;
      await appendTransition({
        sessionId: plan.sessionId,
        by,
        batchId: plan.batchId,
        entity: "assignment",
        id: assignment.assignmentId,
        state: "FINAL_FAILED",
        states: assignmentStates,
        assignmentId: assignment.assignmentId,
        retryCount: retryCounts[assignment.assignmentId] ?? 0,
        payload: { reason, dispatched: false },
      });
      final.set(assignment.assignmentId, "FINAL_FAILED");
    }
  }

  async function dispatch(
    slot: number,
    assignment: TeamworkPlan["assignments"][number],
    retryCount: number,
  ): Promise<void> {
    const boundedId = (kind: string): string => {
      const candidate = `${assignment.assignmentId}.${kind}.${retryCount}`;
      return candidate.length <= 64
        ? candidate
        : crypto
            .createHash("sha256")
            .update(`${assignment.assignmentId}:${kind}:${retryCount}`)
            .digest("hex");
    };
    const attemptId = boundedId("attempt");
    const teammateId = boundedId("teammate");
    const frozen = frozenLaunches.get(assignment.assignmentId);
    if (!frozen)
      throw new Error(`missing frozen launch for '${assignment.assignmentId}'`);
    const { profile, launch } = frozen;
    const context: TeammateDispatchContext = {
      plan,
      assignment,
      attemptId,
      teammateId,
      retryCount,
      profile,
      launch,
    };
    input.runtime.prepare?.(context);
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "assignment",
      id: assignment.assignmentId,
      state: "ASSIGNED",
      states: assignmentStates,
      assignmentId: assignment.assignmentId,
      attemptId,
      teammateId,
      slot,
      retryCount,
      transitionKey: `assignment:${retryCount}`,
    });
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      id: attemptId,
      state: "ASSIGNED",
      states: attemptStates,
      assignmentId: assignment.assignmentId,
      attemptId,
      teammateId,
      retryCount,
    });
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "teammate",
      id: teammateId,
      state: "ASSIGNED",
      states: teammateStates,
      attemptId,
      teammateId,
    });
    writeTeammateClaim({
      taskRoot: input.taskRoot,
      briefPath: assignment.briefPath,
      identity: {
        taskId: plan.taskId,
        batchId: plan.batchId,
        assignmentId: assignment.assignmentId,
        attemptId,
        teammateId,
      },
      planHash: plan.planHash,
      briefDigest: assignment.briefDigest,
      sourceDigest: assignment.sourceDigest,
      slot,
      launch,
    });
    await appendAction({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      action: "lease_acquired",
      attemptId,
      leaseId: `${plan.batchId}:${attemptId}`,
      protected: true,
      payload: { slot },
    });
    await appendAction({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      action: "command_issued",
      id: `${plan.batchId}:dispatch:${attemptId}`,
      attemptId,
      teammateId,
    });
    const launchReceipt = await input.runtime.dispatch(context);
    if (launchReceipt?.providerSessionId)
      context.providerSessionId = launchReceipt.providerSessionId;
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      id: attemptId,
      state: "RUNNING",
      states: attemptStates,
      assignmentId: assignment.assignmentId,
      attemptId,
      teammateId,
      retryCount,
      ...(context.providerSessionId
        ? { providerSessionId: context.providerSessionId }
        : {}),
    });
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "teammate",
      id: teammateId,
      state: "RUNNING",
      states: teammateStates,
      attemptId,
      teammateId,
      ...(context.providerSessionId
        ? { providerSessionId: context.providerSessionId }
        : {}),
    });
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "assignment",
      id: assignment.assignmentId,
      state: "EXECUTING",
      states: assignmentStates,
      assignmentId: assignment.assignmentId,
      attemptId,
      teammateId,
      slot,
      retryCount,
      transitionKey: `attempt:${attemptId}`,
      ...(context.providerSessionId
        ? { providerSessionId: context.providerSessionId }
        : {}),
    });
    const activeWork: ActiveAssignment = {
      slot,
      assignment,
      retryCount,
      continuations: 0,
      ...(context.providerSessionId
        ? { providerSessionId: context.providerSessionId }
        : {}),
      context,
    };
    active.set(slot, activeWork);
    waits.set(
      slot,
      Promise.resolve()
        .then(() => input.runtime.wait(context))
        .then((result) => ({ slot, result }))
        .catch((error: unknown) => ({
          slot,
          result: {
            kind: "reconciliation" as const,
            reason: error instanceof Error ? error.message : String(error),
          },
        })),
    );
    retryCounts[assignment.assignmentId] = retryCount;
  }

  async function release(activeWork: ActiveAssignment): Promise<void> {
    if (activeWork.leaseReleased) return;
    await appendAction({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      action: "lease_released",
      attemptId: activeWork.context.attemptId,
      leaseId: `${plan.batchId}:${activeWork.context.attemptId}`,
      protected: false,
    });
    activeWork.leaseReleased = true;
  }

  async function releaseGuard(): Promise<void> {
    if (!guardHeld) return;
    await input.guard.release({
      batchId: plan.batchId,
      planHash: plan.planHash,
      capacity,
    });
    guardHeld = false;
  }

  async function resumeFromWait(current: ActiveAssignment): Promise<void> {
    if (
      assignmentStates.get(current.assignment.assignmentId) !==
      "WAITING_FOR_MAIN_COMMAND"
    )
      return;
    const transitionKey = `continuation:${current.continuations}`;
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      id: current.context.attemptId,
      state: "RUNNING",
      states: attemptStates,
      assignmentId: current.assignment.assignmentId,
      attemptId: current.context.attemptId,
      teammateId: current.context.teammateId,
      retryCount: current.retryCount,
      ...(current.providerSessionId
        ? { providerSessionId: current.providerSessionId }
        : {}),
      transitionKey,
    });
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "teammate",
      id: current.context.teammateId,
      state: "RUNNING",
      states: teammateStates,
      attemptId: current.context.attemptId,
      teammateId: current.context.teammateId,
      ...(current.providerSessionId
        ? { providerSessionId: current.providerSessionId }
        : {}),
      transitionKey,
    });
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "assignment",
      id: current.assignment.assignmentId,
      state: "EXECUTING",
      states: assignmentStates,
      assignmentId: current.assignment.assignmentId,
      attemptId: current.context.attemptId,
      teammateId: current.context.teammateId,
      retryCount: current.retryCount,
      ...(current.providerSessionId
        ? { providerSessionId: current.providerSessionId }
        : {}),
      transitionKey,
    });
  }

  async function cancelAndDrain(
    reason: string,
    terminal?: { current: ActiveAssignment; result: AttemptWaitResult },
  ): Promise<TeamworkReceipt> {
    await failPending(reason);
    if (batchStates.get(plan.batchId) === "RUNNING") {
      await appendTransition({
        sessionId: plan.sessionId,
        by,
        batchId: plan.batchId,
        entity: "batch",
        id: plan.batchId,
        state: "CANCEL_PENDING",
        states: batchStates,
        payload: { reason },
      });
    }
    const cancel = input.runtime.cancel;
    const outcomes = await Promise.all(
      [...active.values()].map(async (current) => {
        if (terminal?.current === current)
          return { current, result: terminal.result };
        if (!cancel)
          return {
            current,
            error: new Error(`host cannot cancel active attempt: ${reason}`),
          };
        try {
          return { current, result: await cancel(current.context) };
        } catch (error) {
          return { current, error };
        }
      }),
    );
    let cancellationFailure: string | undefined;
    for (const outcome of outcomes) {
      const { current } = outcome;
      if ("error" in outcome) {
        cancellationFailure ??=
          outcome.error instanceof Error
            ? outcome.error.message
            : String(outcome.error);
        continue;
      }
      const { result } = outcome;
      if (
        result.kind === "reconciliation" ||
        result.kind === "timeout" ||
        result.terminal !== true
      ) {
        cancellationFailure ??= `attempt cancellation is not terminal: ${reason}`;
        continue;
      }
      if (
        result.providerSessionId &&
        current.providerSessionId &&
        result.providerSessionId !== current.providerSessionId
      ) {
        cancellationFailure ??=
          "cancellation returned a different host session";
        continue;
      }
      if (result.providerSessionId) {
        current.providerSessionId = result.providerSessionId;
        current.context.providerSessionId = result.providerSessionId;
      }
      try {
        await resumeFromWait(current);
        if (result.kind === "report") {
          await complete(current, false);
        } else
          await fail(
            current,
            result.reason ?? "cancelled by coordinator",
            false,
          );
      } catch (error) {
        cancellationFailure ??=
          error instanceof Error ? error.message : String(error);
        continue;
      }
      active.delete(current.slot);
      waits.delete(current.slot);
    }
    if (cancellationFailure) return reconcile(cancellationFailure);
    return settle();
  }

  async function fail(
    activeWork: ActiveAssignment,
    reason: string,
    allowRetry = true,
  ): Promise<void> {
    const { assignment, context, retryCount } = activeWork;
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      id: context.attemptId,
      state: "FAILED",
      states: attemptStates,
      assignmentId: assignment.assignmentId,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      retryCount,
      ...(activeWork.providerSessionId
        ? { providerSessionId: activeWork.providerSessionId }
        : {}),
      terminal: true,
    });
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "teammate",
      id: context.teammateId,
      state: "FAILED",
      states: teammateStates,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      ...(activeWork.providerSessionId
        ? { providerSessionId: activeWork.providerSessionId }
        : {}),
      terminal: true,
    });
    if (allowRetry && !admissionClosed && retryCount < assignment.maxRetries) {
      await release(activeWork);
      retryCounts[assignment.assignmentId] = retryCount + 1;
      pending.unshift(assignment);
      return;
    }
    writeTeammateDisposition({
      taskRoot: input.taskRoot,
      briefPath: assignment.briefPath,
      identity: {
        taskId: plan.taskId,
        batchId: plan.batchId,
        assignmentId: assignment.assignmentId,
        attemptId: context.attemptId,
        teammateId: context.teammateId,
      },
      sourceDigest: assignment.sourceDigest,
      status: "final_failed",
      reason,
    });
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      id: context.attemptId,
      state: "FINAL_FAILED",
      states: attemptStates,
      assignmentId: assignment.assignmentId,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      retryCount,
      payload: { reason },
    });
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "assignment",
      id: assignment.assignmentId,
      state: "FINAL_FAILED",
      states: assignmentStates,
      assignmentId: assignment.assignmentId,
      retryCount,
      payload: { reason },
    });
    await release(activeWork);
    final.set(assignment.assignmentId, "FINAL_FAILED");
  }

  async function submit(activeWork: ActiveAssignment): Promise<void> {
    const { assignment, context, retryCount } = activeWork;
    try {
      assertTeamworkPlanCurrent(plan, input.taskRoot);
    } catch (error) {
      await fail(
        activeWork,
        `task phase changed before report acceptance: ${error instanceof Error ? error.message : String(error)}`,
        false,
      );
      return;
    }
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "assignment",
      id: assignment.assignmentId,
      state: "AWAITING_REVIEW",
      states: assignmentStates,
      assignmentId: assignment.assignmentId,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      retryCount,
    });
    await release(activeWork);
    final.set(assignment.assignmentId, "AWAITING_REVIEW");
  }

  async function complete(
    activeWork: ActiveAssignment,
    allowRetry = true,
  ): Promise<void> {
    const { assignment, context, retryCount } = activeWork;
    await recordCoordinationEvent({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      action: "terminal_observed",
      assignmentId: assignment.assignmentId,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      ...(activeWork.providerSessionId
        ? { providerSessionId: activeWork.providerSessionId }
        : {}),
      terminal: true,
      idempotencyKey: `${plan.batchId}:terminal:${context.attemptId}`,
    });
    let report: ReturnType<typeof readTeammateReport>;
    try {
      report = readTeammateReport({
        taskRoot: input.taskRoot,
        briefPath: assignment.briefPath,
        attemptId: context.attemptId,
        identity: {
          taskId: plan.taskId,
          batchId: plan.batchId,
          assignmentId: assignment.assignmentId,
          teammateId: context.teammateId,
          planHash: plan.planHash,
          phaseId: plan.phaseId,
          taskRouteRevision: plan.taskRouteRevision,
          inputRevision: plan.inputRevision,
        },
        sourceDigest: assignment.sourceDigest,
      });
    } catch (error) {
      await fail(
        activeWork,
        error instanceof Error ? error.message : String(error),
        error instanceof TeammateReportReadError && error.kind === "missing"
          ? allowRetry
          : false,
      );
      return;
    }
    if (context.launch.reportVersion === 2 && report.schemaVersion !== 2) {
      await fail(
        activeWork,
        "report schema_version must match the frozen result contract (2)",
        allowRetry,
      );
      return;
    }
    try {
      assertTeamworkPlanCurrent(plan, input.taskRoot);
    } catch (error) {
      await fail(
        activeWork,
        `task phase changed before report acceptance: ${error instanceof Error ? error.message : String(error)}`,
        false,
      );
      return;
    }
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "teammate",
      id: context.teammateId,
      state: "REPORT_SUBMITTED",
      states: teammateStates,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      ...(activeWork.providerSessionId
        ? { providerSessionId: activeWork.providerSessionId }
        : {}),
      terminal: true,
    });
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      id: context.attemptId,
      state: "REPORT_SUBMITTED",
      states: attemptStates,
      assignmentId: assignment.assignmentId,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      retryCount,
      ...(activeWork.providerSessionId
        ? { providerSessionId: activeWork.providerSessionId }
        : {}),
      terminal: true,
    });
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "assignment",
      id: assignment.assignmentId,
      state: "REPORT_PENDING",
      states: assignmentStates,
      assignmentId: assignment.assignmentId,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      retryCount,
    });
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "assignment",
      id: assignment.assignmentId,
      state: "VALIDATING",
      states: assignmentStates,
      assignmentId: assignment.assignmentId,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      retryCount,
    });

    await submit(activeWork);
  }

  async function settle(): Promise<TeamworkReceipt> {
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "batch",
      id: plan.batchId,
      state: "SETTLING",
      states: batchStates,
    });
    const pendingReview = plan.assignments.some(
      (assignment) => final.get(assignment.assignmentId) === "AWAITING_REVIEW",
    );
    const status = pendingReview ? "AWAITING_REVIEW" : "SETTLED_WITH_FAILURE";
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "batch",
      id: plan.batchId,
      state: status,
      states: batchStates,
    });
    const receipt = terminalReceiptFromProjection(
      plan,
      await readCoordinationState({ sessionId: plan.sessionId, cwd }),
    );
    await appendAction({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "batch",
      action: "receipt_recorded",
      id: `${plan.batchId}:${status}`,
      payload: { ...receipt },
    });
    await assertTeamworkReceiptDurable(plan, receipt, cwd);
    await releaseGuard();
    return receipt;
  }

  async function fill(): Promise<void> {
    if (admissionClosed) return;
    while (active.size < capacity && pending.length > 0) {
      if (Date.parse(plan.deadline) <= Date.now()) {
        await failPending("batch deadline elapsed before dispatch");
        return;
      }
      try {
        assertTeamworkPlanCurrent(plan, input.taskRoot);
      } catch (error) {
        await failPending(
          `task phase changed before dispatch: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      const assignment = pending[0];
      if (!assignment) return;
      const retryCount = retryCounts[assignment.assignmentId] ?? 0;
      let slot = 0;
      while (active.has(slot)) slot += 1;
      try {
        await dispatch(slot, assignment, retryCount);
        pending.shift();
      } catch (error) {
        if (
          !assignmentStates.has(assignment.assignmentId) ||
          assignmentStates.get(assignment.assignmentId) === "QUEUED"
        ) {
          const reason = `launch preflight failed before dispatch: ${error instanceof Error ? error.message : String(error)}`;
          if (error instanceof TeamworkPolicyChangedError) {
            await failPending(reason);
            return;
          }
          pending.shift();
          await appendTransition({
            sessionId: plan.sessionId,
            by,
            batchId: plan.batchId,
            entity: "assignment",
            id: assignment.assignmentId,
            assignmentId: assignment.assignmentId,
            state: "FINAL_FAILED",
            states: assignmentStates,
            retryCount,
            payload: { reason, dispatched: false },
          });
          final.set(assignment.assignmentId, "FINAL_FAILED");
          continue;
        }
        throw error;
      }
    }
  }

  try {
    await fill();
  } catch (error) {
    return reconcile(error instanceof Error ? error.message : String(error));
  }
  while (active.size > 0) {
    let next:
      | { slot: number; result: AttemptWaitResult }
      | { deadlineExpired: true };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const remaining = Math.max(0, Date.parse(plan.deadline) - Date.now());
      next = await Promise.race([
        ...waits.values(),
        new Promise<{ deadlineExpired: true }>((resolve) => {
          timer = setTimeout(
            () => resolve({ deadlineExpired: true }),
            Math.min(remaining, 2_147_483_647),
          );
        }),
      ]);
    } catch (error) {
      return reconcile(error instanceof Error ? error.message : String(error));
    } finally {
      if (timer) clearTimeout(timer);
    }
    if ("deadlineExpired" in next) {
      if (Date.now() >= Date.parse(plan.deadline))
        return cancelAndDrain("batch deadline elapsed");
      continue;
    }
    const current = active.get(next.slot);
    if (!current) continue;
    waits.delete(next.slot);
    if (
      (next.result.kind === "report" ||
        next.result.kind === "failed" ||
        next.result.kind === "cancelled") &&
      next.result.terminal !== true
    ) {
      return reconcile("host outcome lacks terminal confirmation");
    }
    if (next.result.providerSessionId) {
      if (
        current.providerSessionId &&
        current.providerSessionId !== next.result.providerSessionId
      ) {
        return reconcile("host session identity changed during one attempt");
      }
      current.providerSessionId = next.result.providerSessionId;
      current.context.providerSessionId = next.result.providerSessionId;
    }
    if (next.result.kind === "reconciliation") {
      return reconcile(next.result.reason);
    }
    if (next.result.kind === "cancelled") {
      return cancelAndDrain(next.result.reason ?? "runtime cancellation", {
        current,
        result: next.result,
      });
    }
    try {
      await resumeFromWait(current);
    } catch (error) {
      return reconcile(error instanceof Error ? error.message : String(error));
    }
    let releaseSlot = true;
    if (next.result.kind === "timeout") {
      current.continuations += 1;
      if (Date.now() >= Date.parse(plan.deadline))
        return cancelAndDrain("batch deadline elapsed");
      const transitionKey = `continuation:${current.continuations}`;
      await appendTransition({
        sessionId: plan.sessionId,
        by,
        batchId: plan.batchId,
        entity: "attempt",
        id: current.context.attemptId,
        state: "TIMEOUT_YIELDED",
        states: attemptStates,
        assignmentId: current.assignment.assignmentId,
        attemptId: current.context.attemptId,
        teammateId: current.context.teammateId,
        retryCount: current.retryCount,
        ...(current.providerSessionId
          ? { providerSessionId: current.providerSessionId }
          : {}),
        transitionKey,
      });
      await appendTransition({
        sessionId: plan.sessionId,
        by,
        batchId: plan.batchId,
        entity: "teammate",
        id: current.context.teammateId,
        state: "TIMEOUT_YIELDED",
        states: teammateStates,
        attemptId: current.context.attemptId,
        teammateId: current.context.teammateId,
        ...(current.providerSessionId
          ? { providerSessionId: current.providerSessionId }
          : {}),
        transitionKey,
      });
      await appendTransition({
        sessionId: plan.sessionId,
        by,
        batchId: plan.batchId,
        entity: "assignment",
        id: current.assignment.assignmentId,
        state: "WAITING_FOR_MAIN_COMMAND",
        states: assignmentStates,
        assignmentId: current.assignment.assignmentId,
        attemptId: current.context.attemptId,
        teammateId: current.context.teammateId,
        retryCount: current.retryCount,
        ...(current.providerSessionId
          ? { providerSessionId: current.providerSessionId }
          : {}),
        transitionKey,
      });
      await appendTransition({
        sessionId: plan.sessionId,
        by,
        batchId: plan.batchId,
        entity: "attempt",
        id: current.context.attemptId,
        state: "WAITING_FOR_MAIN_COMMAND",
        states: attemptStates,
        assignmentId: current.assignment.assignmentId,
        attemptId: current.context.attemptId,
        teammateId: current.context.teammateId,
        retryCount: current.retryCount,
        ...(current.providerSessionId
          ? { providerSessionId: current.providerSessionId }
          : {}),
        transitionKey,
      });
      await appendTransition({
        sessionId: plan.sessionId,
        by,
        batchId: plan.batchId,
        entity: "teammate",
        id: current.context.teammateId,
        state: "WAITING_FOR_MAIN_COMMAND",
        states: teammateStates,
        attemptId: current.context.attemptId,
        teammateId: current.context.teammateId,
        ...(current.providerSessionId
          ? { providerSessionId: current.providerSessionId }
          : {}),
        transitionKey,
      });
      let continued: Promise<AttemptWaitResult>;
      try {
        continued = input.runtime.continue(current.context);
      } catch (error) {
        return reconcile(
          error instanceof Error ? error.message : String(error),
        );
      }
      waits.set(
        next.slot,
        Promise.resolve(continued)
          .then((result) => ({ slot: next.slot, result }))
          .catch((error: unknown) => ({
            slot: next.slot,
            result: {
              kind: "reconciliation" as const,
              reason: error instanceof Error ? error.message : String(error),
            },
          })),
      );
      releaseSlot = false;
    } else if (next.result.kind === "report") {
      try {
        await complete(current);
      } catch (error) {
        return reconcile(
          error instanceof Error ? error.message : String(error),
        );
      }
    } else {
      try {
        await fail(current, next.result.reason);
      } catch (error) {
        return reconcile(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    if (releaseSlot) {
      active.delete(next.slot);
      waits.delete(next.slot);
      try {
        await fill();
      } catch (error) {
        return reconcile(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  return settle();
}

export async function assertTeamworkReceiptDurable(
  plan: TeamworkPlan,
  receipt: TeamworkReceipt,
  cwd?: string,
): Promise<void> {
  const [state, events] = await Promise.all([
    readCoordinationState({
      sessionId: plan.sessionId,
      ...(cwd ? { cwd } : {}),
    }),
    readTeamworkEvents({
      sessionId: plan.sessionId,
      ...(cwd ? { cwd } : {}),
    }),
  ]);
  const expected = terminalReceiptFromProjection(plan, state);
  if (!isDeepStrictEqual(receipt, expected))
    throw new Error(
      `batch '${plan.batchId}' receipt disagrees with durable facts`,
    );
  const receipts = events.filter(
    (event) =>
      event.kind === "coordination" &&
      event.batchId === plan.batchId &&
      event.action === "receipt_recorded" &&
      event.payload?.status === receipt.status &&
      event.payload?.status !== "RECONCILIATION_REQUIRED",
  );
  if (
    receipts.length === 0 ||
    !isDeepStrictEqual(receipts.at(-1)?.payload, expected)
  )
    throw new Error(
      `batch '${plan.batchId}' has no matching durable receipt event`,
    );
}

/** Retire uncertain work only from associated terminal or process-birth evidence. */
export async function reconcileTeamworkBatch(input: {
  plan: TeamworkPlan;
  cwd: string;
  execute?: boolean;
  reason?: string;
  confirmUnknownProcessExit?: boolean;
  /** CLI verified the original reservation owner is absent under its lock. */
  coordinatorExited?: boolean;
}): Promise<
  | TeamworkReceipt
  | {
      status: "ready" | "blocked";
      blockers: string[];
      coordinatorRecoveryRequired?: true;
    }
> {
  const { plan, cwd } = input;
  const projection = await readCoordinationState({
    sessionId: plan.sessionId,
    cwd,
  });
  const batch = projection.batches.find(
    (entry) => entry.batchId === plan.batchId,
  );
  if (batch?.planHash !== plan.planHash)
    throw new Error("Batch does not match the frozen plan");
  const events = await readTeamworkEvents({ sessionId: plan.sessionId, cwd });
  const resolving = events.some(
    (event) =>
      event.kind === "coordination" &&
      event.batchId === plan.batchId &&
      event.action === "reconciliation_resolved",
  );
  if (
    ["AWAITING_REVIEW", "ALL_ACCEPTED", "SETTLED_WITH_FAILURE"].includes(
      batch.state,
    )
  ) {
    const receipt = terminalReceiptFromProjection(plan, projection);
    if (input.execute) {
      const recovered = await recoverExistingBatch({
        plan,
        cwd,
        by: "main",
        capacity: receipt.capacity,
      });
      if (!recovered)
        throw new Error("Settled batch disappeared during reconciliation");
      return recovered;
    }
    return receipt;
  }
  const needsRecovery =
    batch.state !== "RECONCILIATION_REQUIRED" &&
    !(resolving && batch.state === "SETTLING");
  if (needsRecovery && !input.coordinatorExited)
    throw new Error(
      "Recover the original batch into RECONCILIATION_REQUIRED first",
    );
  const attempts = projection.attempts.filter(
    (entry) => entry.batchId === plan.batchId,
  );
  const blockers = projection.issues.filter(
    (issue) => !issue.includes(": reconciliation required"),
  );
  for (const attempt of attempts) {
    if (attempt.terminal) continue;
    const facts = events.filter(
      (event) =>
        event.kind === "coordination" &&
        event.batchId === plan.batchId &&
        event.attemptId === attempt.attemptId &&
        event.planHash === plan.planHash,
    );
    if (
      facts.some(
        (event) =>
          event.kind === "coordination" && event.action === "process_exited",
      )
    )
      continue;
    const started = facts
      .filter(
        (event) =>
          event.kind === "coordination" && event.action === "process_started",
      )
      .pop();
    const pid =
      started?.kind === "coordination" ? started.payload?.pid : undefined;
    const birth =
      started?.kind === "coordination"
        ? started.payload?.processIdentity
        : undefined;
    let exited = false;
    let identityUnknown = true;
    if (
      typeof pid === "number" &&
      Number.isSafeInteger(pid) &&
      pid > 0 &&
      typeof birth === "string" &&
      birth.startsWith(`${pid}:`)
    ) {
      const current = readProcessIdentity(pid);
      if (current) {
        exited = current !== birth;
        identityUnknown = false;
      } else {
        try {
          process.kill(pid, 0);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          exited = code === "ESRCH";
          identityUnknown = code !== "ESRCH";
        }
      }
    }
    if (
      !exited &&
      identityUnknown &&
      input.execute &&
      input.confirmUnknownProcessExit &&
      input.reason?.trim()
    )
      exited = true;
    if (!exited)
      blockers.push(
        `Attempt ${attempt.attemptId} lacks confirmed process exit; preserve its lease`,
      );
  }
  if (!input.execute)
    return {
      status: blockers.length ? "blocked" : "ready",
      blockers,
      ...(needsRecovery ? { coordinatorRecoveryRequired: true as const } : {}),
    };
  if (blockers.length) throw new Error(blockers.join("; "));
  if (!input.reason?.trim())
    throw new Error("Reconciliation requires an explicit disposition reason");
  if (needsRecovery) {
    if (
      typeof batch.effectiveCapacity !== "number" ||
      !Number.isSafeInteger(batch.effectiveCapacity) ||
      batch.effectiveCapacity < 1
    )
      throw new Error("Recovered batch lacks its frozen effective capacity");
    await recoverExistingBatch({
      plan,
      cwd,
      by: "main",
      capacity: batch.effectiveCapacity,
    });
    return reconcileTeamworkBatch({ ...input, coordinatorExited: false });
  }
  const by = "main";
  for (const attempt of attempts) {
    await recordCoordinationEvent({
      sessionId: plan.sessionId,
      cwd,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      action: "terminal_observed",
      attemptId: attempt.attemptId,
      teammateId: attempt.teammateId,
      terminal: true,
      reason: input.reason,
      idempotencyKey: `${plan.batchId}:reconciled-terminal:${attempt.attemptId}`,
    });
    if (!["FINAL_FAILED", "REPORT_SUBMITTED"].includes(attempt.state))
      await appendTransition({
        sessionId: plan.sessionId,
        cwd,
        by,
        batchId: plan.batchId,
        entity: "attempt",
        id: attempt.attemptId,
        attemptId: attempt.attemptId,
        assignmentId: attempt.assignmentId,
        teammateId: attempt.teammateId,
        retryCount: attempt.retryCount,
        state: "FINAL_FAILED",
        terminal: true,
        states: new Map([[attempt.attemptId, attempt.state]]),
        transitionKey: "reconcile",
      });
    const teammate = projection.teammates.find(
      (entry) =>
        entry.batchId === plan.batchId &&
        entry.teammateId === attempt.teammateId,
    );
    if (teammate && !["FAILED", "REPORT_SUBMITTED"].includes(teammate.state))
      await appendTransition({
        sessionId: plan.sessionId,
        cwd,
        by,
        batchId: plan.batchId,
        entity: "teammate",
        id: teammate.teammateId,
        teammateId: teammate.teammateId,
        attemptId: attempt.attemptId,
        state: "FAILED",
        terminal: true,
        states: new Map([[teammate.teammateId, teammate.state]]),
        transitionKey: "reconcile",
      });
  }
  for (const assignment of projection.assignments.filter(
    (entry) => entry.batchId === plan.batchId,
  )) {
    if (!["ACCEPTED", "FINAL_FAILED"].includes(assignment.state))
      await appendTransition({
        sessionId: plan.sessionId,
        cwd,
        by,
        batchId: plan.batchId,
        entity: "assignment",
        id: assignment.assignmentId,
        assignmentId: assignment.assignmentId,
        attemptId: assignment.attemptId,
        teammateId: assignment.teammateId,
        retryCount: assignment.retryCount,
        state: "FINAL_FAILED",
        states: new Map([[assignment.assignmentId, assignment.state]]),
        transitionKey: "reconcile",
        payload: { reason: input.reason },
      });
  }
  for (const lease of projection.leases.filter(
    (entry) => entry.batchId === plan.batchId,
  ))
    await recordCoordinationEvent({
      sessionId: plan.sessionId,
      cwd,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      action: "lease_released",
      leaseId: lease.leaseId,
      protected: false,
      reason: input.reason,
      idempotencyKey: `${plan.batchId}:reconciled-release:${lease.leaseId}`,
    });
  const accepted = projection.assignments
    .filter((entry) => entry.batchId === plan.batchId)
    .every((entry) => entry.state === "ACCEPTED");
  const states = new Map<string, CoordinationState>([
    [plan.batchId, batch.state],
  ]);
  await recordCoordinationEvent({
    sessionId: plan.sessionId,
    cwd,
    by,
    batchId: plan.batchId,
    entity: "batch",
    action: "reconciliation_resolved",
    reason: input.reason,
    ...(input.confirmUnknownProcessExit
      ? { payload: { confirmedUnknownProcessExit: true } }
      : {}),
    idempotencyKey: `${plan.batchId}:reconciled:${crypto
      .createHash("sha256")
      .update(input.reason ?? "")
      .digest("hex")}`,
  });
  if (batch.state !== "SETTLING")
    await appendTransition({
      sessionId: plan.sessionId,
      cwd,
      by,
      batchId: plan.batchId,
      entity: "batch",
      id: plan.batchId,
      state: "SETTLING",
      states,
      transitionKey: "reconcile",
    });
  await appendTransition({
    sessionId: plan.sessionId,
    cwd,
    by,
    batchId: plan.batchId,
    entity: "batch",
    id: plan.batchId,
    state: accepted ? "ALL_ACCEPTED" : "SETTLED_WITH_FAILURE",
    states,
    transitionKey: "reconcile",
  });
  const receipt = terminalReceiptFromProjection(
    plan,
    await readCoordinationState({ sessionId: plan.sessionId, cwd }),
  );
  await appendAction({
    sessionId: plan.sessionId,
    cwd,
    by,
    batchId: plan.batchId,
    entity: "batch",
    action: "receipt_recorded",
    id: `${plan.batchId}:${receipt.status}`,
    payload: { ...receipt },
  });
  await assertTeamworkReceiptDurable(plan, receipt, cwd);
  return receipt;
}

/** Read settled facts without admitting work or consulting current resource policy. */
export async function readSettledTeamworkReceipt(
  plan: TeamworkPlan,
  cwd: string,
): Promise<TeamworkReceipt | undefined> {
  const state = await readCoordinationState({ sessionId: plan.sessionId, cwd });
  const batch = state.batches.find((entry) => entry.batchId === plan.batchId);
  if (
    !batch ||
    !["AWAITING_REVIEW", "ALL_ACCEPTED", "SETTLED_WITH_FAILURE"].includes(
      batch.state,
    )
  )
    return undefined;
  const receipt = terminalReceiptFromProjection(plan, state);
  await assertTeamworkReceiptDurable(plan, receipt, cwd);
  return receipt;
}

/** Main-agent review starts only after the CLI has drained the entire batch. */
export async function reviewTeamworkReport(input: {
  plan: TeamworkPlan;
  taskRoot: string;
  cwd: string;
  assignmentId: string;
  reportSha256: string;
  decision: "accepted" | "final_failed";
  reason: string;
  by?: string;
}): Promise<TeamworkReceipt> {
  const { plan, taskRoot, cwd } = input;
  if (!input.reason.trim())
    throw new Error("Review requires an explicit reason");
  const assignment = plan.assignments.find(
    (item) => item.assignmentId === input.assignmentId,
  );
  if (!assignment)
    throw new Error("Review assignment is not in the frozen plan");
  return withLock(
    path.join(taskRoot, "teammates", `${plan.batchId}.review.lock`),
    async () => {
      assertTeamworkPlanCurrent(plan, taskRoot);
      const projection = await readCoordinationState({
        sessionId: plan.sessionId,
        cwd,
      });
      const batch = projection.batches.find(
        (item) => item.batchId === plan.batchId,
      );
      if (
        !batch ||
        !["AWAITING_REVIEW", "ALL_ACCEPTED", "SETTLED_WITH_FAILURE"].includes(
          batch.state,
        )
      )
        throw new Error(
          "Review requires the entire batch to be collected first",
        );
      terminalReceiptFromProjection(plan, projection);
      const work = projection.assignments.find(
        (item) =>
          item.batchId === plan.batchId &&
          item.assignmentId === assignment.assignmentId,
      );
      if (!work?.attemptId || !work.teammateId)
        throw new Error("Review has no matching report attempt");
      readTeammateReport({
        taskRoot,
        briefPath: assignment.briefPath,
        attemptId: work.attemptId,
        identity: {
          taskId: plan.taskId,
          batchId: plan.batchId,
          assignmentId: assignment.assignmentId,
          teammateId: work.teammateId,
          planHash: plan.planHash,
          phaseId: plan.phaseId,
          taskRouteRevision: plan.taskRouteRevision,
          inputRevision: plan.inputRevision,
        },
        sourceDigest: assignment.sourceDigest,
      });
      const reportFile = path.join(
        taskRoot,
        path.dirname(assignment.briefPath),
        "attempts",
        work.attemptId,
        "report.json",
      );
      const reportSha256 = crypto
        .createHash("sha256")
        .update(fs.readFileSync(reportFile))
        .digest("hex");
      if (reportSha256 !== input.reportSha256)
        throw new Error(
          "Review report digest does not match the inspected report",
        );
      const state = input.decision === "accepted" ? "ACCEPTED" : "FINAL_FAILED";
      if (work.state !== "AWAITING_REVIEW" && work.state !== state)
        throw new Error("Report already has a different final disposition");
      const by = input.by ?? "main";
      writeTeammateDisposition({
        taskRoot,
        briefPath: assignment.briefPath,
        identity: {
          taskId: plan.taskId,
          batchId: plan.batchId,
          assignmentId: assignment.assignmentId,
          attemptId: work.attemptId,
          teammateId: work.teammateId,
        },
        sourceDigest: assignment.sourceDigest,
        status: input.decision,
        reason: input.reason,
        review: {
          plan_hash: plan.planHash,
          phase_id: plan.phaseId,
          task_route_revision: plan.taskRouteRevision,
          input_revision: plan.inputRevision,
          report_sha256: reportSha256,
          acceptance: assignment.acceptance,
          by,
        },
      });
      if (work.state === "AWAITING_REVIEW")
        await appendTransition({
          sessionId: plan.sessionId,
          cwd,
          by,
          batchId: plan.batchId,
          entity: "assignment",
          id: assignment.assignmentId,
          assignmentId: assignment.assignmentId,
          attemptId: work.attemptId,
          teammateId: work.teammateId,
          retryCount: work.retryCount,
          state,
          states: new Map([[assignment.assignmentId, work.state]]),
          payload: {
            reason: input.reason,
            reportSha256,
            planHash: plan.planHash,
            acceptance: assignment.acceptance,
          },
        });
      let updated = await readCoordinationState({
        sessionId: plan.sessionId,
        cwd,
      });
      const remaining = updated.assignments.filter(
        (item) => item.batchId === plan.batchId,
      );
      if (
        batch.state === "AWAITING_REVIEW" &&
        !remaining.some((item) => item.state === "AWAITING_REVIEW")
      ) {
        await appendTransition({
          sessionId: plan.sessionId,
          cwd,
          by,
          batchId: plan.batchId,
          entity: "batch",
          id: plan.batchId,
          state: remaining.every((item) => item.state === "ACCEPTED")
            ? "ALL_ACCEPTED"
            : "SETTLED_WITH_FAILURE",
          states: new Map([[plan.batchId, batch.state]]),
        });
        updated = await readCoordinationState({
          sessionId: plan.sessionId,
          cwd,
        });
      }
      const receipt = terminalReceiptFromProjection(plan, updated);
      await appendAction({
        sessionId: plan.sessionId,
        cwd,
        by,
        batchId: plan.batchId,
        entity: "batch",
        action: "receipt_recorded",
        id: `${plan.batchId}:review:${crypto.createHash("sha256").update(JSON.stringify(receipt)).digest("hex")}`,
        payload: { ...receipt },
      });
      await assertTeamworkReceiptDurable(plan, receipt, cwd);
      return receipt;
    },
  );
}
