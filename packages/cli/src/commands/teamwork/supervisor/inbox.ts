/**
 * Inbox watcher: tails events.jsonl for worker-addressed messages and
 * interrupt requests, then forwards accepted input into the worker's stdin.
 * A persisted cursor file keeps respawns from replaying events the previous
 * supervisor already delivered.
 *
 * Step 3 of the supervisor refactor: pulled out of supervisor.ts so the
 * orchestrator only needs to call `runInboxWatcher(...)`. Cursor
 * read/write helpers stay private to this module.
 */

import type { ChildProcessByStdio } from "node:child_process";
import fs from "node:fs";
import type { Readable, Writable } from "node:stream";

import {
  DEFAULT_INBOX_POLICY,
  matchesInboxPolicy,
  type InboxPolicy,
} from "@pennixrv/trellis-core/teamwork";

import type { WorkerAdapter } from "../adapters/index.js";
import { appendEvent } from "../store/events.js";
import { workerFile } from "../store/paths.js";
import { watchEvents } from "../store/watch.js";
import type { TurnTracker } from "./turns.js";
import { buildTaskInput } from "../prompt.js";

type Child = ChildProcessByStdio<Writable, Readable, Readable>;

export interface InboxWatcherArgs {
  sessionId: string;
  workerName: string;
  adapter: WorkerAdapter;
  ctx: unknown;
  child: Child;
  signal: AbortSignal;
  /** Inbox delivery policy. Defaults to `explicitOnly` (legacy behavior). */
  inboxPolicy?: InboxPolicy;
  turnTracker?: TurnTracker;
  context?: string;
}

export async function runInboxWatcher(args: InboxWatcherArgs): Promise<void> {
  const { sessionId, workerName, adapter, ctx, child, signal } = args;
  const inboxPolicy = args.inboxPolicy ?? DEFAULT_INBOX_POLICY;
  // Resume from persisted cursor: first-time spawn → 0 (read full backlog);
  // respawn after kill → last forwarded seq (no replay).
  let cursor = readInboxCursor(sessionId, workerName);
  let contextSent = false;

  for await (const ev of watchEvents(
    sessionId,
    {
      self: workerName, // ignore our own events
      kind: ["message", "interrupt_requested"],
    },
    // First run with cursor=0 reads backlog from start; subsequent runs
    // use sinceSeq to skip already-processed events. Both cases tail
    // future events normally.
    { signal, sinceSeq: cursor, fromStart: cursor === 0 ? true : undefined },
  )) {
    if (signal.aborted) return;
    if (ev.kind === "message") {
      // Core decides delivery from the worker's inbox policy: explicitOnly
      // (default) consumes only targeted messages; broadcastAndExplicit
      // also consumes broadcasts.
      if (!matchesInboxPolicy(ev, workerName, inboxPolicy)) continue;
    } else if ((ev as { worker?: string }).worker !== workerName) {
      continue;
    }

    const text = ((ev as { text?: string }).text ?? "").trim();
    const interruptText = ((ev as { message?: string }).message ?? "").trim();
    const isInterrupt = ev.kind === "interrupt_requested";
    if (!text && (!isInterrupt || !interruptText)) continue;

    // Block until the adapter says it can accept input (e.g. codex
    // thread/start has produced a threadId). Drop the message if we
    // never get ready before being aborted.
    if (!adapter.isReady(ctx)) {
      const deadline = Date.now() + 60_000;
      while (
        !adapter.isReady(ctx) &&
        Date.now() < deadline &&
        !signal.aborted
      ) {
        await sleep(25);
      }
      if (!adapter.isReady(ctx)) {
        if (signal.aborted) return;
        await appendEvent(sessionId, {
          kind: "error",
          by: `supervisor:${workerName}`,
          message:
            "task delivery failed: provider did not become ready before the delivery deadline",
        });
        return;
      }
    }

    if (!isInterrupt) {
      await waitForActiveTurnToFinish(args.turnTracker, signal);
      if (signal.aborted) return;
    }

    if (isInterrupt) {
      const aborted = args.turnTracker?.abortCurrent();
      if (aborted) {
        await appendEvent(sessionId, {
          kind: "turn_finished",
          by: workerName,
          worker: workerName,
          inputSeq: aborted.inputSeq,
          turnId: aborted.turnId,
          outcome: "aborted",
        });
      }
      await appendEvent(sessionId, {
        kind: "interrupted",
        by: workerName,
        worker: workerName,
        ...(aborted?.turnId ? { turnId: aborted.turnId } : {}),
        reason: "user",
        method: "stdin",
        outcome: aborted ? "interrupted" : "no-active-turn",
      });
    }
    let turn = args.turnTracker?.begin(ev.seq);
    try {
      if (turn) {
        await appendEvent(sessionId, {
          kind: "turn_started",
          by: workerName,
          worker: workerName,
          inputSeq: ev.seq,
          turnId: turn.turnId,
        });
      }
      const input =
        args.context && !contextSent
          ? buildTaskInput(isInterrupt ? interruptText : text, args.context)
          : isInterrupt
            ? interruptText
            : text;
      if (adapter.deliverMessage)
        await adapter.deliverMessage(input, ctx, isInterrupt);
      else
        child.stdin.write(
          isInterrupt
            ? adapter.encodeInterruptMessage(input, ctx)
            : adapter.encodeUserMessage(input, ctx),
        );
      contextSent = true;
      cursor = ev.seq;
      writeInboxCursor(sessionId, workerName, cursor);
    } catch (error) {
      await appendEvent(sessionId, {
        kind: "error",
        by: `supervisor:${workerName}`,
        message: `task delivery failed: ${error instanceof Error ? error.message : String(error)}`,
      }).catch(() => undefined);
      if (turn) {
        args.turnTracker?.finish();
        await appendEvent(sessionId, {
          kind: "turn_finished",
          by: workerName,
          worker: workerName,
          inputSeq: turn.inputSeq,
          turnId: turn.turnId,
          outcome: "aborted",
        }).catch(() => undefined);
        turn = undefined;
      }
      // stdin closed, worker exiting — bail out
      return;
    }
  }
}

/**
 * Per-worker inbox consumption cursor. Persisted to
 * `<worker>.inbox-cursor` so a respawn (same worker name) doesn't replay
 * messages that the previous supervisor already forwarded into the worker
 * process. The cursor is the highest seq we've already turned into a
 * worker stdin write.
 */
function readInboxCursor(sessionId: string, workerName: string): number {
  try {
    const raw = fs.readFileSync(
      workerFile(sessionId, workerName, "inbox-cursor"),
      "utf-8",
    );
    const n = Number(raw.trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeInboxCursor(
  sessionId: string,
  workerName: string,
  seq: number,
): void {
  try {
    fs.writeFileSync(
      workerFile(sessionId, workerName, "inbox-cursor"),
      String(seq),
      "utf-8",
    );
  } catch {
    // ignore — cursor is best-effort; worst case we replay a message
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForActiveTurnToFinish(
  turnTracker: TurnTracker | undefined,
  signal: AbortSignal,
): Promise<void> {
  while (turnTracker?.current() && !signal.aborted) {
    await sleep(25);
  }
}
