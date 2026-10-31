import {
  appendEvent,
  readTeamworkEvents,
  type TeamworkEvent,
  type InterruptReason,
} from "../internal/store/events.js";
import { reduceWorkerRegistry } from "../internal/store/worker-state.js";
import { resolveTeamworkSession } from "./resolve.js";
import type { WorkerInterruptResult, WorkerRuntime } from "./runtime.js";
import type { TeamworkSessionAddressOptions, MutationCommonOptions } from "./types.js";

export interface InterruptWorkerInput
  extends TeamworkSessionAddressOptions,
    MutationCommonOptions {
  workerId: string;
  message?: string;
  reason?: InterruptReason;
}

export type InterruptDelivery =
  | "interrupted-current-turn"
  | "no-active-turn"
  | "worker-terminal"
  | "worker-unknown";

export interface InterruptWorkerResult {
  /** Last durable event appended (`interrupted` if attempted, else `interrupt_requested`). */
  event: TeamworkEvent;
  interrupted: boolean;
  delivery: InterruptDelivery;
}

/**
 * Durable-event-only interrupt. Appends an `interrupt_requested` event
 * recording intent. Does not touch any worker runtime.
 */
export async function requestInterrupt(
  input: InterruptWorkerInput,
): Promise<TeamworkEvent> {
  const ref = resolveTeamworkSession({
    sessionId: input.sessionId,
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    ...(input.projectKey !== undefined
      ? { projectKey: input.projectKey }
      : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
  });
  return appendEvent(
    input.sessionId,
    {
      kind: "interrupt_requested",
      by: input.by,
      worker: input.workerId,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(input.origin !== undefined ? { origin: input.origin } : {}),
      ...(input.meta !== undefined ? { meta: input.meta } : {}),
    },
    ref.project,
  );
}

/**
 * Orchestration interrupt. Appends `interrupt_requested`, asks the
 * injected runtime to interrupt the worker, then appends `interrupted`
 * with the runtime-reported `method` / `outcome`. Core never imports CLI
 * provider adapters — the runtime is injected.
 *
 * Skips the runtime call (and the `interrupted` event) when the worker
 * is unknown or terminal in the durable registry.
 */
export async function interruptWorker(
  input: InterruptWorkerInput,
  runtime: WorkerRuntime,
): Promise<InterruptWorkerResult> {
  const ref = resolveTeamworkSession({
    sessionId: input.sessionId,
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    ...(input.projectKey !== undefined
      ? { projectKey: input.projectKey }
      : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
  });

  const events = await readTeamworkEvents(input.sessionId, ref.project);
  const registry = reduceWorkerRegistry(events);
  const worker = registry.workers.find((w) => w.workerId === input.workerId);

  const turnId = worker?.activeTurnId;
  const requestEvent = await appendEvent(
    input.sessionId,
    {
      kind: "interrupt_requested",
      by: input.by,
      worker: input.workerId,
      ...(turnId !== undefined ? { turnId } : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(input.origin !== undefined ? { origin: input.origin } : {}),
      ...(input.meta !== undefined ? { meta: input.meta } : {}),
    },
    ref.project,
  );

  if (!worker) {
    return {
      event: requestEvent,
      interrupted: false,
      delivery: "worker-unknown",
    };
  }
  if (worker.terminal) {
    return {
      event: requestEvent,
      interrupted: false,
      delivery: "worker-terminal",
    };
  }

  const result: WorkerInterruptResult = runtime.interrupt
    ? await runtime.interrupt({
        workerId: input.workerId,
        ...(turnId !== undefined ? { turnId } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.message !== undefined ? { message: input.message } : {}),
      })
    : { method: "none", outcome: "unsupported" };

  const interruptedEvent = await appendEvent(
    input.sessionId,
    {
      kind: "interrupted",
      by: input.by,
      worker: input.workerId,
      method: result.method,
      outcome: result.outcome,
      ...(turnId !== undefined ? { turnId } : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(result.message !== undefined ? { message: result.message } : {}),
      ...(input.origin !== undefined ? { origin: input.origin } : {}),
      ...(input.meta !== undefined ? { meta: input.meta } : {}),
    },
    ref.project,
  );

  const delivery: InterruptDelivery =
    worker.activity === "mid-turn"
      ? "interrupted-current-turn"
      : "no-active-turn";

  return {
    event: interruptedEvent,
    interrupted: result.outcome === "interrupted",
    delivery,
  };
}
