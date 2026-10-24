import fs from "node:fs";

import {
  assertCoordinationTransition,
  readChannelEvents,
  readCoordinationState,
  recordCoordinationEvent,
  type CoordinationState,
} from "@mindfoldhq/trellis-core/channel";

import {
  type BatchPlan,
  type TeammateReport,
  readTeammateReport,
  writeTeammateQueueFact,
  writeTeammateClaim,
  writeTeammateDisposition,
  validateBatchPlan,
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
  | { kind: "report"; terminal: true; sessionId?: string }
  | { kind: "timeout"; reason?: string; sessionId?: string }
  | { kind: "failed"; reason: string; terminal: true; sessionId?: string }
  | { kind: "cancelled"; reason?: string; terminal: true; sessionId?: string }
  | { kind: "reconciliation"; reason: string; sessionId?: string };

export interface TeammateDispatchContext {
  plan: BatchPlan;
  work: BatchPlan["work"][number];
  attemptId: string;
  teammateId: string;
  retryCount: number;
  sessionId?: string;
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
  ): Promise<undefined | { sessionId?: string }>;
  wait(context: TeammateDispatchContext): Promise<AttemptWaitResult>;
  continue(context: TeammateDispatchContext): Promise<AttemptWaitResult>;
  cancel?(context: TeammateDispatchContext): Promise<AttemptWaitResult>;
  validateReport?(
    context: TeammateDispatchContext,
    report: unknown,
  ): Promise<boolean> | boolean;
}

export interface BatchCoordinatorInput {
  plan: unknown;
  taskRoot: string;
  cwd?: string;
  by?: string;
  host: TeammateHostCapabilities;
  runtime: CoordinatorRuntime;
  guard: TeammateGuard;
  config?: TeammateRuntimeConfig;
}

export interface BatchReceipt {
  schemaVersion: 1;
  batchId: string;
  status: "ALL_ACCEPTED" | "SETTLED_WITH_FAILURE" | "RECONCILIATION_REQUIRED";
  work: {
    workId: string;
    status: "ACCEPTED" | "FINAL_FAILED" | "UNKNOWN";
  }[];
  capacity: number;
  retryCounts: Record<string, number>;
  evaluationGroups?: {
    id: string;
    status: "COMPLETE" | "INCOMPLETE";
  }[];
}

function evidenceOverlaps(
  left: TeammateReport,
  right: TeammateReport,
): boolean {
  const identities = new Set(
    left.evidence.map((entry) => JSON.stringify([entry.id, entry.locator])),
  );
  return right.evidence.some((entry) =>
    identities.has(JSON.stringify([entry.id, entry.locator])),
  );
}

async function recoverExistingBatch(input: {
  plan: BatchPlan;
  cwd: string;
  by: string;
  capacity: number;
}): Promise<BatchReceipt | undefined> {
  const projection = await readCoordinationState({
    channel: input.plan.channel,
    cwd: input.cwd,
  });
  const existing = projection.batches.find(
    (batch) => batch.batchId === input.plan.batchId,
  );
  if (!existing) return undefined;
  if (existing.planHash !== input.plan.planHash) {
    throw new Error("batch id already exists with a different plan hash");
  }
  const events = await readChannelEvents({
    channel: input.plan.channel,
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
    return saved.payload as unknown as BatchReceipt;
  }
  const states = new Map<string, CoordinationState>([
    [input.plan.batchId, existing.state],
  ]);
  if (existing.state !== "RECONCILIATION_REQUIRED") {
    await appendTransition({
      channel: input.plan.channel,
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
  const work = input.plan.work.map((item) => {
    const current = projection.work.find(
      (entry) =>
        entry.batchId === input.plan.batchId && entry.workId === item.workId,
    );
    return {
      workId: item.workId,
      status:
        current?.state === "ACCEPTED" || current?.state === "FINAL_FAILED"
          ? current.state
          : "UNKNOWN",
    } as BatchReceipt["work"][number];
  });
  const retryCounts = Object.fromEntries(
    projection.work
      .filter((entry) => entry.batchId === input.plan.batchId)
      .map((entry) => [entry.workId, entry.retryCount]),
  );
  const receipt: BatchReceipt = {
    schemaVersion: 1,
    batchId: input.plan.batchId,
    status: "RECONCILIATION_REQUIRED",
    work,
    capacity: existing.effectiveCapacity ?? input.capacity,
    retryCounts,
  };
  await recordCoordinationEvent({
    channel: input.plan.channel,
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

interface ActiveWork {
  slot: number;
  work: BatchPlan["work"][number];
  retryCount: number;
  continuations: number;
  leaseReleased?: boolean;
  sessionId?: string;
  context: TeammateDispatchContext;
}

function transitionState(
  states: Map<string, CoordinationState>,
  key: string,
  next: CoordinationState,
  entity: "batch" | "work" | "attempt" | "teammate",
): void {
  assertCoordinationTransition(entity, states.get(key), next);
  states.set(key, next);
}

async function appendTransition(input: {
  channel: string;
  by: string;
  batchId: string;
  entity: "batch" | "work" | "attempt" | "teammate";
  id: string;
  state: CoordinationState;
  states: Map<string, CoordinationState>;
  workId?: string;
  attemptId?: string;
  teammateId?: string;
  slot?: number;
  retryCount?: number;
  transitionKey?: string;
  sessionId?: string;
  terminal?: boolean;
  planHash?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  transitionState(input.states, input.id, input.state, input.entity);
  await recordCoordinationEvent({
    channel: input.channel,
    by: input.by,
    batchId: input.batchId,
    entity: input.entity,
    action: "state_transition",
    state: input.state,
    ...(input.workId ? { workId: input.workId } : {}),
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    ...(input.teammateId ? { teammateId: input.teammateId } : {}),
    ...(input.slot !== undefined ? { slot: input.slot } : {}),
    ...(input.retryCount !== undefined ? { retryCount: input.retryCount } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.terminal !== undefined ? { terminal: input.terminal } : {}),
    ...(input.planHash ? { planHash: input.planHash } : {}),
    ...(input.payload ? { payload: input.payload } : {}),
    idempotencyKey: `${input.batchId}:${input.entity}:${input.id}:${input.state}:${input.transitionKey ?? "initial"}`,
  });
}

async function appendAction(input: {
  channel: string;
  by: string;
  batchId: string;
  entity: "batch" | "work" | "attempt" | "teammate";
  action:
    | "claim_created"
    | "command_issued"
    | "receipt_recorded"
    | "lease_acquired"
    | "lease_released"
    | "reconciliation_required";
  id?: string;
  workId?: string;
  attemptId?: string;
  teammateId?: string;
  leaseId?: string;
  protected?: boolean;
  reason?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await recordCoordinationEvent({
    channel: input.channel,
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
    ...(input.workId ? { workId: input.workId } : {}),
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

export function loadBatchPlan(planPath: string, taskRoot: string): BatchPlan {
  return validateBatchPlan(readPlanFile(planPath), taskRoot);
}

export async function runBatchCoordinator(
  input: BatchCoordinatorInput,
): Promise<BatchReceipt> {
  const plan = validateBatchPlan(input.plan, input.taskRoot);
  const cwd = input.cwd ?? input.taskRoot;
  const frozenLaunches = new Map<
    string,
    {
      profile: ReturnType<typeof resolveTeammateProfile>;
      launch: TeammateLaunchSpec;
    }
  >();
  for (const work of plan.work) {
    assertTeammateAdapterContract(work.provider);
    const profile = resolveTeammateProfile({
      cwd,
      profile: work.profile,
      provider: work.provider,
      model: work.model,
    });
    frozenLaunches.set(work.workId, {
      profile,
      launch: buildTeammateLaunchSpec({
        cwd,
        profile,
        host: input.host,
        contextFiles: work.contextFiles,
        contextManifests: work.contextManifests,
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
  const workStates = new Map<string, CoordinationState>();
  const attemptStates = new Map<string, CoordinationState>();
  const teammateStates = new Map<string, CoordinationState>();
  await input.guard.acquire({
    batchId: plan.batchId,
    planHash: plan.planHash,
    capacity,
  });
  let guardHeld = true;
  let recovered: BatchReceipt | undefined;
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
    for (const [queueIndex, work] of plan.work.entries()) {
      writeTeammateQueueFact({
        taskRoot: input.taskRoot,
        briefPath: work.briefPath,
        taskId: plan.taskId,
        batchId: plan.batchId,
        workId: work.workId,
        planHash: plan.planHash,
        briefDigest: work.briefDigest,
        sourceDigest: work.sourceDigest,
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
    channel: plan.channel,
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
    channel: plan.channel,
    by,
    batchId: plan.batchId,
    entity: "batch",
    id: plan.batchId,
    state: "VALIDATING_PLAN",
    states: batchStates,
    planHash: plan.planHash,
  });
  for (const work of plan.work) {
    await appendTransition({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "work",
      id: work.workId,
      state: "QUEUED",
      states: workStates,
      workId: work.workId,
      retryCount: 0,
    });
    await appendAction({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "work",
      action: "claim_created",
      id: `${plan.batchId}:work:${work.workId}`,
      workId: work.workId,
    });
  }
  await appendTransition({
    channel: plan.channel,
    by,
    batchId: plan.batchId,
    entity: "batch",
    id: plan.batchId,
    state: "RUNNING",
    states: batchStates,
    planHash: plan.planHash,
  });

  const pending = [...plan.work];
  const active = new Map<number, ActiveWork>();
  const waits = new Map<
    number,
    Promise<{ slot: number; result: AttemptWaitResult }>
  >();
  const final = new Map<string, "ACCEPTED" | "FINAL_FAILED">();
  const acceptedReports = new Map<string, TeammateReport>();
  const pendingCounterReports = new Map<
    string,
    { activeWork: ActiveWork; report: TeammateReport }
  >();
  const retryCounts: Record<string, number> = {};

  async function reconcile(reason: string): Promise<BatchReceipt> {
    await appendAction({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "batch",
      action: "reconciliation_required",
      reason,
    });
    if (batchStates.get(plan.batchId) !== "RECONCILIATION_REQUIRED") {
      await appendTransition({
        channel: plan.channel,
        by,
        batchId: plan.batchId,
        entity: "batch",
        id: plan.batchId,
        state: "RECONCILIATION_REQUIRED",
        states: batchStates,
      });
    }
    const receipt: BatchReceipt = {
      schemaVersion: 1,
      batchId: plan.batchId,
      status: "RECONCILIATION_REQUIRED",
      work: plan.work.map((item) => ({
        workId: item.workId,
        status: final.get(item.workId) ?? "UNKNOWN",
      })),
      capacity,
      retryCounts,
    };
    await appendAction({
      channel: plan.channel,
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
    work: BatchPlan["work"][number],
    retryCount: number,
  ): Promise<void> {
    const attemptId = `${work.workId}.attempt.${retryCount}`;
    const teammateId = `${work.workId}.teammate.${retryCount}`;
    const frozen = frozenLaunches.get(work.workId);
    if (!frozen) throw new Error(`missing frozen launch for '${work.workId}'`);
    const { profile, launch } = frozen;
    const context: TeammateDispatchContext = {
      plan,
      work,
      attemptId,
      teammateId,
      retryCount,
      profile,
      launch,
    };
    await appendTransition({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "work",
      id: work.workId,
      state: "ASSIGNED",
      states: workStates,
      workId: work.workId,
      attemptId,
      teammateId,
      slot,
      retryCount,
      transitionKey: `assignment:${retryCount}`,
    });
    await appendTransition({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      id: attemptId,
      state: "ASSIGNED",
      states: attemptStates,
      workId: work.workId,
      attemptId,
      teammateId,
      retryCount,
    });
    await appendTransition({
      channel: plan.channel,
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
      briefPath: work.briefPath,
      identity: {
        taskId: plan.taskId,
        batchId: plan.batchId,
        workId: work.workId,
        attemptId,
        teammateId,
      },
      planHash: plan.planHash,
      briefDigest: work.briefDigest,
      sourceDigest: work.sourceDigest,
      slot,
      launch,
    });
    await appendAction({
      channel: plan.channel,
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
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      action: "command_issued",
      id: `${plan.batchId}:dispatch:${attemptId}`,
      attemptId,
      teammateId,
    });
    const launchReceipt = await input.runtime.dispatch(context);
    if (launchReceipt?.sessionId) context.sessionId = launchReceipt.sessionId;
    await appendTransition({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      id: attemptId,
      state: "RUNNING",
      states: attemptStates,
      workId: work.workId,
      attemptId,
      teammateId,
      retryCount,
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    });
    await appendTransition({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "teammate",
      id: teammateId,
      state: "RUNNING",
      states: teammateStates,
      attemptId,
      teammateId,
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    });
    await appendTransition({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "work",
      id: work.workId,
      state: "EXECUTING",
      states: workStates,
      workId: work.workId,
      attemptId,
      teammateId,
      slot,
      retryCount,
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    });
    const activeWork: ActiveWork = {
      slot,
      work,
      retryCount,
      continuations: 0,
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
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
    retryCounts[work.workId] = retryCount;
  }

  async function release(activeWork: ActiveWork): Promise<void> {
    if (activeWork.leaseReleased) return;
    await appendAction({
      channel: plan.channel,
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
    terminal?: { current: ActiveWork; result: AttemptWaitResult },
  ): Promise<BatchReceipt> {
    if (batchStates.get(plan.batchId) === "RUNNING") {
      await appendTransition({
        channel: plan.channel,
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
        result.sessionId &&
        current.sessionId &&
        result.sessionId !== current.sessionId
      ) {
        return reconcile("cancellation returned a different host session");
      }
      if (result.sessionId) {
        current.sessionId = result.sessionId;
        current.context.sessionId = result.sessionId;
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
      return reconcile(`queued work remains after cancellation: ${reason}`);
    return settle();
  }

  async function fail(
    activeWork: ActiveWork,
    reason: string,
    allowRetry = true,
  ): Promise<void> {
    const { work, context, retryCount } = activeWork;
    await appendTransition({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      id: context.attemptId,
      state: "FAILED",
      states: attemptStates,
      workId: work.workId,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      retryCount,
      ...(activeWork.sessionId ? { sessionId: activeWork.sessionId } : {}),
      terminal: true,
    });
    await appendTransition({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "teammate",
      id: context.teammateId,
      state: "FAILED",
      states: teammateStates,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      ...(activeWork.sessionId ? { sessionId: activeWork.sessionId } : {}),
      terminal: true,
    });
    if (allowRetry && retryCount < work.maxRetries) {
      await release(activeWork);
      retryCounts[work.workId] = retryCount + 1;
      pending.unshift(work);
      return;
    }
    writeTeammateDisposition({
      taskRoot: input.taskRoot,
      briefPath: work.briefPath,
      identity: {
        taskId: plan.taskId,
        batchId: plan.batchId,
        workId: work.workId,
        attemptId: context.attemptId,
        teammateId: context.teammateId,
      },
      sourceDigest: work.sourceDigest,
      status: "final_failed",
      reason,
    });
    await appendTransition({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      id: context.attemptId,
      state: "FINAL_FAILED",
      states: attemptStates,
      workId: work.workId,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      retryCount,
      payload: { reason },
    });
    await appendTransition({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "work",
      id: work.workId,
      state: "FINAL_FAILED",
      states: workStates,
      workId: work.workId,
      retryCount,
      payload: { reason },
    });
    await release(activeWork);
    final.set(work.workId, "FINAL_FAILED");
    await resolvePendingCounter(work.workId);
  }

  async function accept(
    activeWork: ActiveWork,
    report: TeammateReport,
  ): Promise<void> {
    const { work, context, retryCount } = activeWork;
    writeTeammateDisposition({
      taskRoot: input.taskRoot,
      briefPath: work.briefPath,
      identity: {
        taskId: plan.taskId,
        batchId: plan.batchId,
        workId: work.workId,
        attemptId: context.attemptId,
        teammateId: context.teammateId,
      },
      sourceDigest: work.sourceDigest,
      status: "accepted",
    });
    await appendTransition({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "work",
      id: work.workId,
      state: "ACCEPTED",
      states: workStates,
      workId: work.workId,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      retryCount,
    });
    await release(activeWork);
    acceptedReports.set(work.workId, report);
    final.set(work.workId, "ACCEPTED");
    await resolvePendingCounter(work.workId);
  }

  async function resolvePendingCounter(primaryWorkId: string): Promise<void> {
    const counter = plan.work.find((work) => work.counterOf === primaryWorkId);
    if (!counter) return;
    const pending = pendingCounterReports.get(counter.workId);
    if (!pending) return;
    pendingCounterReports.delete(counter.workId);
    if (final.get(primaryWorkId) === "FINAL_FAILED") {
      await fail(
        pending.activeWork,
        `counter primary '${primaryWorkId}' did not complete`,
        false,
      );
      return;
    }
    const primaryReport = acceptedReports.get(primaryWorkId);
    if (!primaryReport) return;
    if (evidenceOverlaps(primaryReport, pending.report)) {
      await fail(
        pending.activeWork,
        `counter evidence overlaps primary '${primaryWorkId}'`,
      );
      return;
    }
    await accept(pending.activeWork, pending.report);
  }

  async function complete(
    activeWork: ActiveWork,
    allowRetry = true,
  ): Promise<void> {
    const { work, context, retryCount } = activeWork;
    await recordCoordinationEvent({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      action: "terminal_observed",
      workId: work.workId,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      ...(activeWork.sessionId ? { sessionId: activeWork.sessionId } : {}),
      terminal: true,
      idempotencyKey: `${plan.batchId}:terminal:${context.attemptId}`,
    });
    let report;
    try {
      report = readTeammateReport({
        taskRoot: input.taskRoot,
        briefPath: work.briefPath,
        attemptId: context.attemptId,
        identity: {
          taskId: plan.taskId,
          batchId: plan.batchId,
          workId: work.workId,
          teammateId: context.teammateId,
        },
        sourceDigest: work.sourceDigest,
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
    await appendTransition({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "teammate",
      id: context.teammateId,
      state: "REPORT_SUBMITTED",
      states: teammateStates,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      ...(activeWork.sessionId ? { sessionId: activeWork.sessionId } : {}),
      terminal: true,
    });
    await appendTransition({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "attempt",
      id: context.attemptId,
      state: "REPORT_SUBMITTED",
      states: attemptStates,
      workId: work.workId,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      retryCount,
      ...(activeWork.sessionId ? { sessionId: activeWork.sessionId } : {}),
      terminal: true,
    });
    await appendTransition({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "work",
      id: work.workId,
      state: "REPORT_PENDING",
      states: workStates,
      workId: work.workId,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      retryCount,
    });
    await appendTransition({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "work",
      id: work.workId,
      state: "VALIDATING",
      states: workStates,
      workId: work.workId,
      attemptId: context.attemptId,
      teammateId: context.teammateId,
      retryCount,
    });
    if (work.counterOf) {
      const primaryStatus = final.get(work.counterOf);
      if (primaryStatus === "FINAL_FAILED") {
        await fail(
          activeWork,
          `counter primary '${work.counterOf}' did not complete`,
          false,
        );
        return;
      }
      const primaryReport = acceptedReports.get(work.counterOf);
      if (!primaryReport) {
        pendingCounterReports.set(work.workId, { activeWork, report });
        active.delete(activeWork.slot);
        waits.delete(activeWork.slot);
        await release(activeWork);
        return;
      }
      if (evidenceOverlaps(primaryReport, report)) {
        await fail(
          activeWork,
          `counter evidence overlaps primary '${work.counterOf}'`,
          allowRetry,
        );
        return;
      }
    }
    await accept(activeWork, report);
  }

  async function settle(): Promise<BatchReceipt> {
    await appendTransition({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "batch",
      id: plan.batchId,
      state: "SETTLING",
      states: batchStates,
    });
    const accepted = plan.work.every(
      (work) => final.get(work.workId) === "ACCEPTED",
    );
    const status = accepted ? "ALL_ACCEPTED" : "SETTLED_WITH_FAILURE";
    await appendTransition({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "batch",
      id: plan.batchId,
      state: status,
      states: batchStates,
    });
    const receipt: BatchReceipt = {
      schemaVersion: 1,
      batchId: plan.batchId,
      status,
      work: plan.work.map((work) => ({
        workId: work.workId,
        status: final.get(work.workId) ?? "FINAL_FAILED",
      })),
      capacity,
      retryCounts,
      evaluationGroups: [
        ...new Set(
          plan.work
            .map((work) => work.evaluationGroup?.id)
            .filter((id): id is string => id !== undefined),
        ),
      ].map((id) => ({
        id,
        status: plan.work
          .filter((work) => work.evaluationGroup?.id === id)
          .every((work) => final.get(work.workId) === "ACCEPTED")
          ? "COMPLETE"
          : "INCOMPLETE",
      })),
    };
    await appendAction({
      channel: plan.channel,
      by,
      batchId: plan.batchId,
      entity: "batch",
      action: "receipt_recorded",
      id: `${plan.batchId}:${status}`,
      payload: { ...receipt },
    });
    await assertBatchReceiptDurable(
      plan.channel,
      plan.batchId,
      plan.planHash,
      cwd,
    );
    await releaseGuard();
    return receipt;
  }

  async function fill(): Promise<void> {
    while (active.size < capacity && pending.length > 0) {
      const work = pending.shift();
      if (!work) return;
      const retryCount = retryCounts[work.workId] ?? 0;
      let slot = 0;
      while (active.has(slot)) slot += 1;
      await dispatch(slot, work, retryCount);
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
    if (next.result.sessionId) {
      if (current.sessionId && current.sessionId !== next.result.sessionId) {
        return reconcile("host session identity changed during one attempt");
      }
      current.sessionId = next.result.sessionId;
      current.context.sessionId = next.result.sessionId;
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
          channel: plan.channel,
          by,
          batchId: plan.batchId,
          entity: "attempt",
          id: current.context.attemptId,
          state: "TIMEOUT_YIELDED",
          states: attemptStates,
          workId: current.work.workId,
          attemptId: current.context.attemptId,
          teammateId: current.context.teammateId,
          retryCount: current.retryCount,
          ...(current.sessionId ? { sessionId: current.sessionId } : {}),
          transitionKey: `continuation:${current.continuations}`,
        });
        await appendTransition({
          channel: plan.channel,
          by,
          batchId: plan.batchId,
          entity: "teammate",
          id: current.context.teammateId,
          state: "TIMEOUT_YIELDED",
          states: teammateStates,
          attemptId: current.context.attemptId,
          teammateId: current.context.teammateId,
          ...(current.sessionId ? { sessionId: current.sessionId } : {}),
          transitionKey: `continuation:${current.continuations}`,
        });
        await appendTransition({
          channel: plan.channel,
          by,
          batchId: plan.batchId,
          entity: "work",
          id: current.work.workId,
          state: "WAITING_FOR_MAIN_COMMAND",
          states: workStates,
          workId: current.work.workId,
          attemptId: current.context.attemptId,
          teammateId: current.context.teammateId,
          retryCount: current.retryCount,
          ...(current.sessionId ? { sessionId: current.sessionId } : {}),
          transitionKey: `continuation:${current.continuations}`,
        });
        await appendTransition({
          channel: plan.channel,
          by,
          batchId: plan.batchId,
          entity: "attempt",
          id: current.context.attemptId,
          state: "WAITING_FOR_MAIN_COMMAND",
          states: attemptStates,
          workId: current.work.workId,
          attemptId: current.context.attemptId,
          teammateId: current.context.teammateId,
          retryCount: current.retryCount,
          ...(current.sessionId ? { sessionId: current.sessionId } : {}),
          transitionKey: `continuation:${current.continuations}`,
        });
        await appendTransition({
          channel: plan.channel,
          by,
          batchId: plan.batchId,
          entity: "teammate",
          id: current.context.teammateId,
          state: "WAITING_FOR_MAIN_COMMAND",
          states: teammateStates,
          attemptId: current.context.attemptId,
          teammateId: current.context.teammateId,
          ...(current.sessionId ? { sessionId: current.sessionId } : {}),
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
          continued.sessionId &&
          current.sessionId &&
          continued.sessionId !== current.sessionId
        ) {
          return reconcile("continuation returned a different host session");
        }
        if (continued.sessionId) {
          current.sessionId = continued.sessionId;
          current.context.sessionId = continued.sessionId;
        }
        await appendTransition({
          channel: plan.channel,
          by,
          batchId: plan.batchId,
          entity: "attempt",
          id: current.context.attemptId,
          state: "RUNNING",
          states: attemptStates,
          workId: current.work.workId,
          attemptId: current.context.attemptId,
          teammateId: current.context.teammateId,
          retryCount: current.retryCount,
          ...(current.sessionId ? { sessionId: current.sessionId } : {}),
          transitionKey: `continuation:${current.continuations}`,
        });
        await appendTransition({
          channel: plan.channel,
          by,
          batchId: plan.batchId,
          entity: "teammate",
          id: current.context.teammateId,
          state: "RUNNING",
          states: teammateStates,
          attemptId: current.context.attemptId,
          teammateId: current.context.teammateId,
          ...(current.sessionId ? { sessionId: current.sessionId } : {}),
          transitionKey: `continuation:${current.continuations}`,
        });
        await appendTransition({
          channel: plan.channel,
          by,
          batchId: plan.batchId,
          entity: "work",
          id: current.work.workId,
          state: "EXECUTING",
          states: workStates,
          workId: current.work.workId,
          attemptId: current.context.attemptId,
          teammateId: current.context.teammateId,
          retryCount: current.retryCount,
          ...(current.sessionId ? { sessionId: current.sessionId } : {}),
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

export async function assertBatchReceiptDurable(
  channel: string,
  batchId: string,
  planHash: string,
  cwd?: string,
): Promise<void> {
  const [state, events] = await Promise.all([
    readCoordinationState({ channel, ...(cwd ? { cwd } : {}) }),
    readChannelEvents({ channel, ...(cwd ? { cwd } : {}) }),
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
