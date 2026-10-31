import fs from "node:fs";
import path from "node:path";

import {
  isTaskPhaseId,
  parseTaskWorkflowState,
} from "@mindfoldhq/trellis-core/task";
import {
  assertCoordinationTransition,
  readTeamworkEvents,
  readCoordinationState,
  recordCoordinationEvent,
  type CoordinationState,
} from "@mindfoldhq/trellis-core/teamwork";

import {
  type TeamworkPlan,
  cleanupSettledTeamworkArtifacts,
  readTeammateReport,
  writeTeammateQueueFact,
  writeTeammateClaim,
  writeTeammateDisposition,
  validateTeamworkPlan,
} from "./artifact.js";
import {
  assertTeammateAdapterContract,
  type TeammateHostCapabilities,
} from "./teammate-adapters.js";
import {
  effectiveTeammateCapacity,
  resolveTeammateRuntimeConfig,
  type TeammateRuntimeConfig,
} from "./teammate-config.js";
import { resolveTeammateProfile } from "./profiles.js";
import {
  buildTeammateLaunchSpec,
  type TeammateLaunchSpec,
} from "./teammate-launch.js";

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
  dispatch(
    context: TeammateDispatchContext,
  ): Promise<undefined | { providerSessionId?: string }>;
  wait(context: TeammateDispatchContext): Promise<AttemptWaitResult>;
  continue(context: TeammateDispatchContext): Promise<AttemptWaitResult>;
  cancel?(context: TeammateDispatchContext): Promise<AttemptWaitResult>;
  validateReport?(
    context: TeammateDispatchContext,
    report: unknown,
  ): Promise<boolean> | boolean;
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

export interface TeamworkReceipt {
  schemaVersion: 1;
  batchId: string;
  status: "ALL_ACCEPTED" | "SETTLED_WITH_FAILURE" | "RECONCILIATION_REQUIRED";
  assignments: {
    assignmentId: string;
    status: "ACCEPTED" | "FINAL_FAILED" | "UNKNOWN";
  }[];
  capacity: number;
  retryCounts: Record<string, number>;
  evaluationGroups?: {
    id: string;
    status: "COMPLETE" | "INCOMPLETE";
  }[];
}

export function assertTeamworkPlanCurrent(
  plan: TeamworkPlan,
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
  const saved = events.find(
    (event) =>
      event.kind === "coordination" &&
      event.batchId === input.plan.batchId &&
      event.action === "receipt_recorded" &&
      event.payload &&
      (event.payload.status === "ALL_ACCEPTED" ||
        event.payload.status === "SETTLED_WITH_FAILURE"),
  );
  if (saved?.kind === "coordination" && saved.payload) {
    return saved.payload as unknown as TeamworkReceipt;
  }
  const states = new Map<string, CoordinationState>([
    [input.plan.batchId, existing.state],
  ]);
  if (existing.state !== "RECONCILIATION_REQUIRED") {
    await appendTransition({
      sessionId: input.plan.sessionId,
      by: input.by,
      batchId: input.plan.batchId,
      entity: "batch",
      id: input.plan.batchId,
      state: "RECONCILIATION_REQUIRED",
      states,
      planHash: input.plan.planHash,
      payload: { recoveredAfterRestart: true },
    });
  }
  const assignments = input.plan.assignments.map((item) => {
    const current = projection.assignments.find(
      (entry) =>
        entry.batchId === input.plan.batchId &&
        entry.assignmentId === item.assignmentId,
    );
    return {
      assignmentId: item.assignmentId,
      status:
        current?.state === "ACCEPTED" || current?.state === "FINAL_FAILED"
          ? current.state
          : "UNKNOWN",
    } as TeamworkReceipt["assignments"][number];
  });
  const retryCounts = Object.fromEntries(
    projection.assignments
      .filter((entry) => entry.batchId === input.plan.batchId)
      .map((entry) => [entry.assignmentId, entry.retryCount]),
  );
  const receipt: TeamworkReceipt = {
    schemaVersion: 1,
    batchId: input.plan.batchId,
    status: "RECONCILIATION_REQUIRED",
    assignments,
    capacity: existing.effectiveCapacity ?? input.capacity,
    retryCounts,
  };
  await recordCoordinationEvent({
    sessionId: input.plan.sessionId,
    cwd: input.cwd,
    by: input.by,
    batchId: input.plan.batchId,
    entity: "batch",
    action: "receipt_recorded",
    receiptId: `${input.plan.batchId}:RECONCILIATION_REQUIRED`,
    payload: { ...receipt, reason: "recovered batch requires reconciliation" },
    idempotencyKey: `${input.plan.batchId}:RECONCILIATION_REQUIRED:receipt`,
  });
  return receipt;
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

function readPlanFile(planPath: string): unknown {
  const raw = fs.readFileSync(planPath, "utf8");
  return JSON.parse(raw) as unknown;
}

export function loadTeamworkPlan(
  planPath: string,
  taskRoot: string,
): TeamworkPlan {
  const plan = validateTeamworkPlan(readPlanFile(planPath), taskRoot);
  assertTeamworkPlanCurrent(plan, taskRoot);
  return plan;
}

export async function runTeamworkCoordinator(
  input: TeamworkCoordinatorInput,
): Promise<TeamworkReceipt> {
  const plan = validateTeamworkPlan(input.plan, input.taskRoot);
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
    const profile = resolveTeammateProfile({
      cwd,
      profile: assignment.profile,
      provider: assignment.provider,
      model: assignment.model,
    });
    frozenLaunches.set(assignment.assignmentId, {
      profile,
      launch: buildTeammateLaunchSpec({
        cwd,
        profile,
        host: input.host,
        contextFiles: assignment.contextFiles,
        contextManifests: assignment.contextManifests,
        protectedTargets: plan.protectedTargets,
      }),
    });
  }
  const config = input.config ?? resolveTeammateRuntimeConfig(cwd);
  const capacity = effectiveTeammateCapacity({
    requested: plan.requestedCapacity,
    config,
    verifiedHostCap: input.host.verifiedHostCap,
  });
  const by = input.by ?? "main";
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
  let recovered: TeamworkReceipt | undefined;
  try {
    recovered = await recoverExistingBatch({ plan, cwd, by, capacity });
  } catch (error) {
    await input.guard.release({
      batchId: plan.batchId,
      planHash: plan.planHash,
      capacity,
    });
    guardHeld = false;
    throw error;
  }
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
  const final = new Map<string, "ACCEPTED" | "FINAL_FAILED">();
  const acceptedAttempts = new Map<string, string>();
  const retryCounts: Record<string, number> = {};

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

  async function dispatch(
    slot: number,
    assignment: TeamworkPlan["assignments"][number],
    retryCount: number,
  ): Promise<void> {
    const attemptId = `${assignment.assignmentId}.attempt.${retryCount}`;
    const teammateId = `${assignment.assignmentId}.teammate.${retryCount}`;
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

  async function cancelAndDrain(
    reason: string,
    terminal?: { current: ActiveAssignment; result: AttemptWaitResult },
  ): Promise<TeamworkReceipt> {
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
    if (!input.runtime.cancel && active.size > 0 && !terminal) {
      return reconcile(`host cannot confirm cancellation: ${reason}`);
    }
    for (const current of [...active.values()]) {
      let result: AttemptWaitResult;
      if (terminal?.current === current) {
        result = terminal.result;
      } else {
        try {
          if (!input.runtime.cancel)
            return reconcile(`host cannot cancel active attempt: ${reason}`);
          result = await input.runtime.cancel(current.context);
        } catch (error) {
          return reconcile(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      if (
        result.kind === "reconciliation" ||
        result.kind === "timeout" ||
        result.terminal !== true
      ) {
        return reconcile(`attempt cancellation is not terminal: ${reason}`);
      }
      if (
        result.providerSessionId &&
        current.providerSessionId &&
        result.providerSessionId !== current.providerSessionId
      ) {
        return reconcile("cancellation returned a different host session");
      }
      if (result.providerSessionId) {
        current.providerSessionId = result.providerSessionId;
        current.context.providerSessionId = result.providerSessionId;
      }
      try {
        if (result.kind === "report") await complete(current, false);
        else
          await fail(
            current,
            result.reason ?? "cancelled by coordinator",
            false,
          );
      } catch (error) {
        return reconcile(
          error instanceof Error ? error.message : String(error),
        );
      }
      active.delete(current.slot);
      waits.delete(current.slot);
    }
    if (pending.length > 0)
      return reconcile(
        `queued assignment remains after cancellation: ${reason}`,
      );
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
    if (allowRetry && retryCount < assignment.maxRetries) {
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

  async function accept(activeWork: ActiveAssignment): Promise<void> {
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
      status: "accepted",
    });
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "assignment",
      id: assignment.assignmentId,
      state: "ACCEPTED",
      states: assignmentStates,
      assignmentId: assignment.assignmentId,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      retryCount,
    });
    await release(activeWork);
    final.set(assignment.assignmentId, "ACCEPTED");
    acceptedAttempts.set(assignment.assignmentId, context.attemptId);
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
    let report;
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
        allowRetry,
      );
      return;
    }
    if (
      input.runtime.validateReport &&
      !(await input.runtime.validateReport(context, report))
    ) {
      await fail(
        activeWork,
        "report rejected by acceptance contract",
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

    await accept(activeWork);
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
    const cleanupFailures = cleanupSettledTeamworkArtifacts({
      taskRoot: input.taskRoot,
      assignments: plan.assignments,
      acceptedAttempts,
    });
    if (cleanupFailures.length > 0) {
      return reconcile(
        `Teamwork batch cleanup failed: ${cleanupFailures.join("; ")}`,
      );
    }
    const accepted = plan.assignments.every(
      (assignment) => final.get(assignment.assignmentId) === "ACCEPTED",
    );
    const status = accepted ? "ALL_ACCEPTED" : "SETTLED_WITH_FAILURE";
    await appendTransition({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "batch",
      id: plan.batchId,
      state: status,
      states: batchStates,
    });
    const receipt: TeamworkReceipt = {
      schemaVersion: 1,
      batchId: plan.batchId,
      status,
      assignments: plan.assignments.map((assignment) => ({
        assignmentId: assignment.assignmentId,
        status: final.get(assignment.assignmentId) ?? "FINAL_FAILED",
      })),
      capacity,
      retryCounts,
      evaluationGroups: [
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
            (assignment) => final.get(assignment.assignmentId) === "ACCEPTED",
          )
          ? "COMPLETE"
          : "INCOMPLETE",
      })),
    };
    await appendAction({
      sessionId: plan.sessionId,
      by,
      batchId: plan.batchId,
      entity: "batch",
      action: "receipt_recorded",
      id: `${plan.batchId}:${status}`,
      payload: { ...receipt },
    });
    await assertTeamworkReceiptDurable(
      plan.sessionId,
      plan.batchId,
      plan.planHash,
      cwd,
    );
    await releaseGuard();
    return receipt;
  }

  async function fill(): Promise<void> {
    while (active.size < capacity && pending.length > 0) {
      const assignment = pending.shift();
      if (!assignment) return;
      const retryCount = retryCounts[assignment.assignmentId] ?? 0;
      let slot = 0;
      while (active.has(slot)) slot += 1;
      await dispatch(slot, assignment, retryCount);
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
    let releaseSlot = true;
    if (next.result.kind === "timeout") {
      current.continuations += 1;
      if (current.continuations > 8) {
        return reconcile("continuation limit exceeded");
      } else {
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
          transitionKey: `continuation:${current.continuations}`,
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
          transitionKey: `continuation:${current.continuations}`,
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
          transitionKey: `continuation:${current.continuations}`,
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
          transitionKey: `continuation:${current.continuations}`,
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
          transitionKey: `continuation:${current.continuations}`,
        });
        let continued: AttemptWaitResult;
        try {
          continued = await input.runtime.continue(current.context);
        } catch (error) {
          return reconcile(
            error instanceof Error ? error.message : String(error),
          );
        }
        if (
          continued.providerSessionId &&
          current.providerSessionId &&
          continued.providerSessionId !== current.providerSessionId
        ) {
          return reconcile("continuation returned a different host session");
        }
        if (continued.providerSessionId) {
          current.providerSessionId = continued.providerSessionId;
          current.context.providerSessionId = continued.providerSessionId;
        }
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
          transitionKey: `continuation:${current.continuations}`,
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
          transitionKey: `continuation:${current.continuations}`,
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
          transitionKey: `continuation:${current.continuations}`,
        });
        waits.set(
          next.slot,
          Promise.resolve({ slot: next.slot, result: continued }),
        );
        releaseSlot = false;
      }
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
  sessionId: string,
  batchId: string,
  planHash: string,
  cwd?: string,
): Promise<void> {
  const [state, events] = await Promise.all([
    readCoordinationState({ sessionId, ...(cwd ? { cwd } : {}) }),
    readTeamworkEvents({ sessionId, ...(cwd ? { cwd } : {}) }),
  ]);
  const batch = state.batches.find((entry) => entry.batchId === batchId);
  if (
    batch?.planHash !== planHash ||
    (batch.state !== "ALL_ACCEPTED" && batch.state !== "SETTLED_WITH_FAILURE")
  ) {
    throw new Error(`batch '${batchId}' has no durable terminal receipt`);
  }
  const receiptRecorded = events.some(
    (event) =>
      event.kind === "coordination" &&
      event.batchId === batchId &&
      event.action === "receipt_recorded" &&
      event.payload?.status === batch.state,
  );
  if (!receiptRecorded) {
    throw new Error(`batch '${batchId}' has no matching durable receipt event`);
  }
}
