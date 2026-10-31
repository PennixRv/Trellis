import {
  appendEvent,
  readTeamworkEvents,
} from "../internal/store/events.js";
import { DEFAULT_INBOX_POLICY } from "../internal/store/inbox.js";
import {
  reduceWorkerRegistry,
  type WorkerState,
} from "../internal/store/worker-state.js";
import { resolveTeamworkSession } from "./resolve.js";
import type {
  SpawnWorkerInput,
  WorkerRuntime,
  WorkerStartInput,
} from "./runtime.js";

/**
 * Spawn a worker through a provider-injected runtime.
 *
 * Core resolves the Teamwork Session, asks the injected runtime to start the
 * worker process, appends the durable `spawned` event (with runtime
 * metadata and the selected inbox policy), and returns the projected
 * {@link WorkerState}. The runtime owns process launch details; core
 * owns event writes and state projection.
 */
export async function spawnWorker(
  input: SpawnWorkerInput,
  runtime: WorkerRuntime,
): Promise<WorkerState> {
  const ref = resolveTeamworkSession({
    sessionId: input.sessionId,
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    ...(input.projectKey !== undefined
      ? { projectKey: input.projectKey }
      : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
  });

  const startInput: WorkerStartInput = {
    sessionId: ref,
    workerId: input.workerId,
    cwd: input.cwd,
    systemPrompt: input.systemPrompt,
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.resume !== undefined ? { resume: input.resume } : {}),
  };
  const handle = await runtime.start(startInput);

  const inboxPolicy = input.inboxPolicy ?? DEFAULT_INBOX_POLICY;
  await appendEvent(
    input.sessionId,
    {
      kind: "spawned",
      by: input.by,
      as: input.workerId,
      inboxPolicy,
      ...(input.provider ?? handle.provider
        ? { provider: input.provider ?? handle.provider }
        : {}),
      ...(handle.pid !== undefined ? { pid: handle.pid } : {}),
      ...(input.agent !== undefined ? { agent: input.agent } : {}),
      ...(input.meta !== undefined ? { meta: input.meta } : {}),
    },
    ref.project,
  );

  const events = await readTeamworkEvents(input.sessionId, ref.project);
  const registry = reduceWorkerRegistry(events, ref);
  const state = registry.workers.find(
    (w) => w.workerId === input.workerId,
  );
  if (!state) {
    // Should never happen — we just appended the spawned event.
    throw new Error(
      `spawnWorker: worker '${input.workerId}' missing from registry after spawn`,
    );
  }
  return state;
}
