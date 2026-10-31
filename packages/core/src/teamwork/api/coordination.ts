import {
  appendEvent,
  readTeamworkEvents,
  type AppendablePartial,
  type CoordinationAction,
  type CoordinationTeamworkEvent,
  type CoordinationEntity,
  type CoordinationState,
} from "../internal/store/events.js";
import {
  reduceCoordinationState,
  type CoordinationProjection,
} from "../internal/store/coordination.js";
import { resolveTeamworkSession } from "./resolve.js";
import type { TeamworkSessionScope } from "../internal/store/schema.js";

export interface RecordCoordinationEventInput {
  sessionId: string;
  scope?: TeamworkSessionScope;
  projectKey?: string;
  cwd?: string;
  by: string;
  batchId: string;
  entity: CoordinationEntity;
  action: CoordinationAction;
  state?: CoordinationState;
  assignmentId?: string;
  attemptId?: string;
  teammateId?: string;
  slot?: number;
  retryCount?: number;
  planHash?: string;
  commandId?: string;
  claimId?: string;
  receiptId?: string;
  leaseId?: string;
  protected?: boolean;
  providerSessionId?: string;
  terminal?: boolean;
  reason?: string;
  outcome?: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
}

export async function recordCoordinationEvent(
  input: RecordCoordinationEventInput,
): Promise<CoordinationTeamworkEvent> {
  const ref = resolveTeamworkSession({
    sessionId: input.sessionId,
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    ...(input.projectKey !== undefined ? { projectKey: input.projectKey } : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
  });
  const partial: AppendablePartial = {
    kind: "coordination",
    by: input.by,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    entity: input.entity,
    action: input.action,
    batchId: input.batchId,
    ...(input.state ? { state: input.state } : {}),
    ...(input.assignmentId ? { assignmentId: input.assignmentId } : {}),
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    ...(input.teammateId ? { teammateId: input.teammateId } : {}),
    ...(input.slot !== undefined ? { slot: input.slot } : {}),
    ...(input.retryCount !== undefined ? { retryCount: input.retryCount } : {}),
    ...(input.planHash ? { planHash: input.planHash } : {}),
    ...(input.commandId ? { commandId: input.commandId } : {}),
    ...(input.claimId ? { claimId: input.claimId } : {}),
    ...(input.receiptId ? { receiptId: input.receiptId } : {}),
    ...(input.leaseId ? { leaseId: input.leaseId } : {}),
    ...(input.protected !== undefined ? { protected: input.protected } : {}),
    ...(input.providerSessionId
      ? { providerSessionId: input.providerSessionId }
      : {}),
    ...(input.terminal !== undefined ? { terminal: input.terminal } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.outcome ? { outcome: input.outcome } : {}),
    ...(input.payload ? { payload: input.payload } : {}),
  };
  return (await appendEvent(input.sessionId, partial, ref.project)) as CoordinationTeamworkEvent;
}

export interface ReadCoordinationStateInput {
  sessionId: string;
  scope?: TeamworkSessionScope;
  projectKey?: string;
  cwd?: string;
}

export async function readCoordinationState(
  input: ReadCoordinationStateInput,
): Promise<CoordinationProjection> {
  const ref = resolveTeamworkSession({
    sessionId: input.sessionId,
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    ...(input.projectKey !== undefined ? { projectKey: input.projectKey } : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
  });
  const events = await readTeamworkEvents(input.sessionId, ref.project);
  return reduceCoordinationState(events);
}
