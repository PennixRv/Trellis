import {
  appendEvent,
  readTeamworkEvents,
  type MessageTeamworkEvent,
} from "../internal/store/events.js";
import { classifyDelivery } from "../internal/store/delivery.js";
import { reduceWorkerRegistry } from "../internal/store/worker-state.js";
import { resolveTeamworkSession } from "./resolve.js";
import type { SendMessageOptions } from "./types.js";

export async function sendMessage(
  opts: SendMessageOptions,
): Promise<MessageTeamworkEvent> {
  const ref = resolveTeamworkSession({
    sessionId: opts.sessionId,
    ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
    ...(opts.projectKey !== undefined ? { projectKey: opts.projectKey } : {}),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  const event = (await appendEvent(
    opts.sessionId,
    {
      kind: "message",
      by: opts.by,
      ...(opts.idempotencyKey !== undefined
        ? { idempotencyKey: opts.idempotencyKey }
        : {}),
      text: opts.text,
      ...(opts.to !== undefined ? { to: opts.to } : {}),
      ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
      ...(opts.meta !== undefined ? { meta: opts.meta } : {}),
    },
    ref.project,
  )) as MessageTeamworkEvent;

  // Strict delivery modes: classify targets against the durable worker
  // registry and append `undeliverable` for failures. The message event
  // is already durable above, so user intent is never lost. Replays use
  // the persisted event target, not the caller's retry payload.
  const mode = opts.deliveryMode ?? "appendOnly";
  if (mode !== "appendOnly" && event.to !== undefined) {
    const targets = Array.isArray(event.to) ? event.to : [event.to];
    const events = await readTeamworkEvents(opts.sessionId, ref.project);
    const registry = reduceWorkerRegistry(events);
    const failures = classifyDelivery(registry, targets, mode);
    for (const failure of failures) {
      await appendEvent(
        opts.sessionId,
        {
          kind: "undeliverable",
          by: opts.by,
          ...(opts.idempotencyKey !== undefined
            ? {
                idempotencyKey: `${opts.idempotencyKey}:undeliverable:${failure.targetWorker}`,
              }
            : {}),
          targetWorker: failure.targetWorker,
          messageSeq: event.seq,
          reason: failure.reason,
          ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
          ...(opts.meta !== undefined ? { meta: opts.meta } : {}),
        },
        ref.project,
      );
    }
  }

  return event;
}
