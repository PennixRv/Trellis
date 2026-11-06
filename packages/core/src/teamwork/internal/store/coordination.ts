import {
  isCoordinationEvent,
  type TeamworkEvent,
  type CoordinationAction,
  type CoordinationAttemptState,
  type CoordinationBatchState,
  type CoordinationTeamworkEvent,
  type CoordinationEntity,
  type CoordinationState,
  type CoordinationTeammateState,
  type CoordinationAssignmentState,
} from "./events.js";

export interface CoordinationBatchProjection {
  batchId: string;
  state: CoordinationBatchState;
  planHash?: string;
  requestedCapacity?: number;
  effectiveCapacity?: number;
  lastSeq: number;
}

export interface CoordinationAssignmentProjection {
  batchId: string;
  assignmentId: string;
  state: CoordinationAssignmentState;
  slot?: number;
  attemptId?: string;
  teammateId?: string;
  retryCount: number;
  lastSeq: number;
}

export interface CoordinationAttemptProjection {
  batchId: string;
  assignmentId?: string;
  attemptId: string;
  state: CoordinationAttemptState;
  teammateId?: string;
  providerSessionId?: string;
  terminal?: boolean;
  retryCount: number;
  lastSeq: number;
}

export interface CoordinationTeammateProjection {
  batchId: string;
  teammateId: string;
  state: CoordinationTeammateState;
  attemptId?: string;
  providerSessionId?: string;
  terminal?: boolean;
  lastSeq: number;
}

export interface CoordinationLeaseProjection {
  batchId: string;
  leaseId: string;
  protected: boolean;
  owner?: string;
  expiresAt?: string;
  lastSeq: number;
}

export interface CoordinationProjection {
  batches: CoordinationBatchProjection[];
  assignments: CoordinationAssignmentProjection[];
  attempts: CoordinationAttemptProjection[];
  teammates: CoordinationTeammateProjection[];
  leases: CoordinationLeaseProjection[];
  claims: string[];
  commands: string[];
  receipts: string[];
  issues: string[];
  lastSeq: number;
}

const BATCH_TRANSITIONS: Record<string, readonly string[]> = {
  PREPARED: [
    "VALIDATING_PLAN",
    "SUSPENDED",
    "CANCEL_PENDING",
    "RECONCILIATION_REQUIRED",
  ],
  VALIDATING_PLAN: ["RUNNING", "SUSPENDED", "RECONCILIATION_REQUIRED"],
  RUNNING: [
    "SETTLING",
    "SUSPENDED",
    "CANCEL_PENDING",
    "RECONCILIATION_REQUIRED",
  ],
  SETTLING: ["AWAITING_REVIEW", "ALL_ACCEPTED", "SETTLED_WITH_FAILURE", "RECONCILIATION_REQUIRED"],
  AWAITING_REVIEW: ["ALL_ACCEPTED", "SETTLED_WITH_FAILURE", "RECONCILIATION_REQUIRED"],
  SUSPENDED: ["RUNNING", "CANCEL_PENDING", "RECONCILIATION_REQUIRED"],
  CANCEL_PENDING: ["SETTLING", "RECONCILIATION_REQUIRED"],
  RECONCILIATION_REQUIRED: [
    "VALIDATING_PLAN",
    "RUNNING",
    "SETTLING",
    "SETTLED_WITH_FAILURE",
  ],
  ALL_ACCEPTED: [],
  SETTLED_WITH_FAILURE: [],
};

const WORK_TRANSITIONS: Record<string, readonly string[]> = {
  QUEUED: ["ASSIGNED", "FINAL_FAILED"],
  ASSIGNED: ["EXECUTING", "FINAL_FAILED", "WAITING_FOR_MAIN_COMMAND"],
  EXECUTING: [
    "REPORT_PENDING",
    "ASSIGNED",
    "FINAL_FAILED",
    "WAITING_FOR_MAIN_COMMAND",
  ],
  REPORT_PENDING: ["VALIDATING", "ASSIGNED", "FINAL_FAILED"],
  VALIDATING: ["AWAITING_REVIEW", "ACCEPTED", "ASSIGNED", "FINAL_FAILED"],
  AWAITING_REVIEW: ["ACCEPTED", "FINAL_FAILED"],
  WAITING_FOR_MAIN_COMMAND: ["EXECUTING", "ASSIGNED", "FINAL_FAILED"],
  ACCEPTED: [],
  FINAL_FAILED: [],
};

const ATTEMPT_TRANSITIONS: Record<string, readonly string[]> = {
  ASSIGNED: ["RUNNING", "FAILED", "TIMEOUT_YIELDED", "FINAL_FAILED"],
  RUNNING: ["REPORT_SUBMITTED", "FAILED", "TIMEOUT_YIELDED", "FINAL_FAILED"],
  REPORT_SUBMITTED: ["FAILED", "FINAL_FAILED"],
  FAILED: ["FINAL_FAILED", "ASSIGNED"],
  TIMEOUT_YIELDED: ["WAITING_FOR_MAIN_COMMAND", "FINAL_FAILED"],
  WAITING_FOR_MAIN_COMMAND: ["RUNNING", "FINAL_FAILED"],
  FINAL_FAILED: [],
};

const TEAMMATE_TRANSITIONS: Record<string, readonly string[]> = {
  ASSIGNED: ["RUNNING", "FAILED", "TIMEOUT_YIELDED"],
  RUNNING: ["REPORT_SUBMITTED", "FAILED", "TIMEOUT_YIELDED"],
  REPORT_SUBMITTED: ["FAILED", "FINAL_FAILED"],
  FAILED: [],
  TIMEOUT_YIELDED: ["WAITING_FOR_MAIN_COMMAND", "FAILED"],
  WAITING_FOR_MAIN_COMMAND: ["RUNNING", "FAILED"],
};

function transitionTable(
  entity: CoordinationEntity,
): Record<string, readonly string[]> {
  switch (entity) {
    case "batch":
      return BATCH_TRANSITIONS;
    case "assignment":
      return WORK_TRANSITIONS;
    case "attempt":
      return ATTEMPT_TRANSITIONS;
    case "teammate":
      return TEAMMATE_TRANSITIONS;
  }
}

export function isCoordinationAction(
  value: unknown,
): value is CoordinationAction {
  return (
    value === "state_transition" ||
    value === "terminal_observed" ||
    value === "claim_created" ||
    value === "command_issued" ||
    value === "receipt_recorded" ||
    value === "lease_acquired" ||
    value === "lease_released" ||
    value === "reconciliation_required" ||
    value === "reconciliation_resolved" ||
    value === "process_started" ||
    value === "process_exited"
  );
}

export function canTransition(
  entity: CoordinationEntity,
  current: CoordinationState | undefined,
  next: CoordinationState,
): boolean {
  if (current === undefined) {
    return (
      (entity === "batch" && next === "PREPARED") ||
      (entity === "assignment" && next === "QUEUED") ||
      (entity === "attempt" && next === "ASSIGNED") ||
      (entity === "teammate" && next === "ASSIGNED")
    );
  }
  return transitionTable(entity)[current]?.includes(next) ?? false;
}

export function assertCoordinationTransition(
  entity: CoordinationEntity,
  current: CoordinationState | undefined,
  next: CoordinationState,
): void {
  if (!canTransition(entity, current, next)) {
    throw new Error(
      `invalid ${entity} transition ${current ?? "<none>"} -> ${next}`,
    );
  }
}

function idFor(ev: CoordinationTeamworkEvent): string | undefined {
  switch (ev.entity) {
    case "batch":
      return ev.batchId;
    case "assignment":
      return ev.assignmentId;
    case "attempt":
      return ev.attemptId;
    case "teammate":
      return ev.teammateId;
  }
}

function scopedId(batchId: string, id: string): string {
  return JSON.stringify([batchId, id]);
}

function transitionIssue(
  ev: CoordinationTeamworkEvent,
  current?: CoordinationState,
): string {
  return `${ev.seq}: invalid ${ev.entity} transition ${current ?? "<none>"} -> ${ev.state ?? "<missing>"}`;
}

export function reduceCoordinationState(
  events: readonly TeamworkEvent[],
): CoordinationProjection {
  const batches = new Map<string, CoordinationBatchProjection>();
  const work = new Map<string, CoordinationAssignmentProjection>();
  const attempts = new Map<string, CoordinationAttemptProjection>();
  const teammates = new Map<string, CoordinationTeammateProjection>();
  const leases = new Map<string, CoordinationLeaseProjection>();
  const claims: string[] = [];
  const commands: string[] = [];
  const receipts: string[] = [];
  const issues: string[] = [];
  const reconciliations = new Map<string, string>();

  for (const event of events) {
    if (!isCoordinationEvent(event)) continue;
    if (!isCoordinationAction(event.action)) {
      issues.push(`${event.seq}: unknown coordination action`);
      continue;
    }
    if (event.seq > 0) {
      // Sequence is projected at the end as a monotonic high-water mark.
    }
    if (event.action === "claim_created") {
      if (event.claimId && !claims.includes(event.claimId))
        claims.push(event.claimId);
      continue;
    }
    if (event.action === "command_issued") {
      if (event.commandId && !commands.includes(event.commandId))
        commands.push(event.commandId);
      continue;
    }
    if (event.action === "receipt_recorded") {
      if (event.receiptId && !receipts.includes(event.receiptId))
        receipts.push(event.receiptId);
      continue;
    }
    if (
      event.action === "lease_acquired" ||
      event.action === "lease_released"
    ) {
      if (!event.leaseId) {
        issues.push(`${event.seq}: lease event has no leaseId`);
        continue;
      }
      const key = scopedId(event.batchId, event.leaseId);
      const prior = leases.get(key);
      if (event.action === "lease_released") {
        leases.delete(key);
      } else {
        leases.set(key, {
          batchId: event.batchId,
          leaseId: event.leaseId,
          protected: event.protected === true,
          ...(event.meta?.owner && typeof event.meta.owner === "string"
            ? { owner: event.meta.owner }
            : prior?.owner
              ? { owner: prior.owner }
              : {}),
          ...(event.meta?.expiresAt && typeof event.meta.expiresAt === "string"
            ? { expiresAt: event.meta.expiresAt }
            : prior?.expiresAt
              ? { expiresAt: prior.expiresAt }
              : {}),
          lastSeq: event.seq,
        });
      }
      continue;
    }
    if (event.action === "terminal_observed") {
      if (
        event.entity !== "attempt" ||
        !event.attemptId ||
        event.terminal !== true
      ) {
        issues.push(`${event.seq}: terminal fact is missing attempt identity`);
        continue;
      }
      const attemptKey = scopedId(event.batchId, event.attemptId);
      const attempt = attempts.get(attemptKey);
      if (attempt?.batchId !== event.batchId) {
        issues.push(
          `${event.seq}: terminal fact references an unknown attempt`,
        );
        continue;
      }
      attempts.set(attemptKey, {
        ...attempt,
        ...(event.providerSessionId
          ? { providerSessionId: event.providerSessionId }
          : {}),
        terminal: true,
        lastSeq: event.seq,
      });
      if (event.teammateId) {
        const teammateKey = scopedId(event.batchId, event.teammateId);
        const teammate = teammates.get(teammateKey);
        if (teammate?.batchId !== event.batchId) {
          issues.push(
            `${event.seq}: terminal fact references an unknown teammate`,
          );
        } else {
          teammates.set(teammateKey, {
            ...teammate,
            ...(event.providerSessionId
              ? { providerSessionId: event.providerSessionId }
              : {}),
            terminal: true,
            lastSeq: event.seq,
          });
        }
      }
      continue;
    }
    if (event.action === "reconciliation_required") {
      reconciliations.set(
        event.batchId,
        `${event.seq}: reconciliation required${event.reason ? `: ${event.reason}` : ""}`,
      );
    }
    if (event.action === "reconciliation_resolved")
      reconciliations.delete(event.batchId);
    if (event.action !== "state_transition") continue;
    const id = idFor(event);
    if (!id || !event.state) {
      issues.push(
        `${event.seq}: state transition is missing identity or state`,
      );
      continue;
    }

    const current =
      event.entity === "batch"
        ? batches.get(id)?.state
        : event.entity === "assignment"
          ? work.get(scopedId(event.batchId, id))?.state
          : event.entity === "attempt"
            ? attempts.get(scopedId(event.batchId, id))?.state
            : teammates.get(scopedId(event.batchId, id))?.state;
    if (!canTransition(event.entity, current, event.state)) {
      issues.push(transitionIssue(event, current));
      continue;
    }
    if (event.entity === "batch") {
      const previous = batches.get(id);
      batches.set(id, {
        batchId: id,
        state: event.state as CoordinationBatchState,
        ...(event.planHash
          ? { planHash: event.planHash }
          : previous?.planHash
            ? { planHash: previous.planHash }
            : {}),
        ...(typeof event.payload?.requestedCapacity === "number"
          ? { requestedCapacity: event.payload.requestedCapacity }
          : previous?.requestedCapacity !== undefined
            ? { requestedCapacity: previous.requestedCapacity }
            : {}),
        ...(typeof event.payload?.effectiveCapacity === "number"
          ? { effectiveCapacity: event.payload.effectiveCapacity }
          : previous?.effectiveCapacity !== undefined
            ? { effectiveCapacity: previous.effectiveCapacity }
            : {}),
        lastSeq: event.seq,
      });
    } else if (event.entity === "assignment") {
      work.set(scopedId(event.batchId, id), {
        batchId: event.batchId,
        assignmentId: id,
        state: event.state as CoordinationAssignmentState,
        ...(event.slot !== undefined ? { slot: event.slot } : {}),
        ...(event.attemptId ? { attemptId: event.attemptId } : {}),
        ...(event.teammateId ? { teammateId: event.teammateId } : {}),
        retryCount: event.retryCount ?? 0,
        lastSeq: event.seq,
      });
    } else if (event.entity === "attempt") {
      const key = scopedId(event.batchId, id);
      const previous = attempts.get(key);
      attempts.set(key, {
        batchId: event.batchId,
        ...(event.assignmentId ? { assignmentId: event.assignmentId } : {}),
        attemptId: id,
        state: event.state as CoordinationAttemptState,
        ...(event.teammateId ? { teammateId: event.teammateId } : {}),
        ...(event.providerSessionId
          ? { providerSessionId: event.providerSessionId }
          : previous?.providerSessionId
            ? { providerSessionId: previous.providerSessionId }
            : {}),
        ...(event.terminal !== undefined
          ? { terminal: event.terminal }
          : previous?.terminal !== undefined
            ? { terminal: previous.terminal }
            : {}),
        retryCount: event.retryCount ?? 0,
        lastSeq: event.seq,
      });
    } else {
      const key = scopedId(event.batchId, id);
      const previous = teammates.get(key);
      teammates.set(key, {
        batchId: event.batchId,
        teammateId: id,
        state: event.state as CoordinationTeammateState,
        ...(event.attemptId ? { attemptId: event.attemptId } : {}),
        ...(event.providerSessionId
          ? { providerSessionId: event.providerSessionId }
          : previous?.providerSessionId
            ? { providerSessionId: previous.providerSessionId }
            : {}),
        ...(event.terminal !== undefined
          ? { terminal: event.terminal }
          : previous?.terminal !== undefined
            ? { terminal: previous.terminal }
            : {}),
        lastSeq: event.seq,
      });
    }
  }

  return {
    batches: [...batches.values()],
    assignments: [...work.values()],
    attempts: [...attempts.values()],
    teammates: [...teammates.values()],
    leases: [...leases.values()],
    claims,
    commands,
    receipts,
    issues: [...issues, ...reconciliations.values()],
    lastSeq: events.reduce((max, event) => Math.max(max, event.seq), 0),
  };
}
