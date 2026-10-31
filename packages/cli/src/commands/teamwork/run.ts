/**
 * `teamwork run` — one-shot wrapper for short tasks: create an ephemeral
 * Teamwork Session, spawn one teammate, send a single prompt, wait for `done`,
 * print the teammate's final message, and clean up.
 *
 * Scope (decided in plan-r2):
 *   - single teammate only (multi-unit plans use `teamwork batch`)
 *   - failure preserves the Teamwork Session and prints its path so the user can
 *     inspect; success removes it
 */

import crypto from "node:crypto";
import fs from "node:fs";

import type { Provider } from "./adapters/index.js";
import { createTeamworkSession } from "./create.js";
import { teamworkSessionRm } from "./rm.js";
import { teamworkSessionSend } from "./send.js";
import { teamworkSessionSpawn } from "./spawn.js";
import { sessionDir, eventsPath } from "./store/paths.js";
import type { TeamworkEvent } from "./store/events.js";
import { watchEvents } from "./store/watch.js";

export interface RunOptions {
  /** Optional Teamwork Session name; auto-generated if omitted. */
  name?: string;
  agent?: string;
  provider?: Provider;
  as?: string;
  cwd?: string;
  model?: string;
  files?: string[];
  jsonls?: string[];
  message?: string;
  textFile?: string;
  stdin?: boolean;
  /** Per-worker timeout (defaults to 5m if not specified). */
  timeoutMs?: number;
}

export async function teamworkSessionRun(opts: RunOptions): Promise<void> {
  const name = opts.name ?? `run-${crypto.randomBytes(4).toString("hex")}`;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;

  await createTeamworkSession(name, {
    by: "main",
    cwd: opts.cwd,
    ephemeral: true,
    origin: "run",
  });

  let workerName: string | null = null;
  let succeeded = false;
  try {
    const spawned = await teamworkSessionSpawn(name, {
      agent: opts.agent,
      provider: opts.provider,
      as: opts.as,
      cwd: opts.cwd,
      model: opts.model,
      timeoutMs,
      files: opts.files,
      jsonls: opts.jsonls,
    });
    workerName = spawned.worker;

    await teamworkSessionSend(name, {
      as: "main",
      to: workerName,
      text: opts.message,
      textFile: opts.textFile,
      stdin: opts.stdin,
    });

    await waitForDone(name, workerName, timeoutMs);
    await printFinalMessage(name, workerName);
    succeeded = true;
  } finally {
    if (succeeded) {
      // Clean removal — the Teamwork Session served its purpose.
      await teamworkSessionRm(name, { force: true });
    } else {
      // Failure path: keep the Teamwork Session so the user can inspect events.jsonl,
      // logs, pid state etc. The ephemeral flag remains, so a later
      // `teamwork prune --ephemeral` will still clean it.
      const dir = sessionDir(name);
      process.stderr.write(
        `Teamwork Session kept for inspection: ${dir}\n` +
          `(ephemeral — will be removed by \`teamwork prune --ephemeral\`)\n`,
      );
      process.exitCode = 1;
    }
  }
}

/**
 * Block until the worker emits a `done` event, throwing on timeout or
 * `error` event (so the run.ts caller takes the "keep on failure" path).
 */
async function waitForDone(
  sessionId: string,
  workerName: string,
  timeoutMs: number,
): Promise<void> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    for await (const ev of watchEvents(
      sessionId,
      {
        self: "main",
        from: [workerName],
      },
      { signal: abort.signal },
    )) {
      if (ev.kind === "done") return;
      if (ev.kind === "error") {
        const msg = (ev as { message?: string }).message ?? "(no message)";
        throw new Error(`teammate ${workerName} reported error: ${msg}`);
      }
      if (ev.kind === "killed") {
        const reason = (ev as { reason?: string }).reason ?? "(unknown)";
        throw new Error(`teammate ${workerName} killed before done: ${reason}`);
      }
    }
    throw new Error(`timeout waiting for teammate ${workerName} to finish`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Print the worker's final user-visible message. Stdout is reserved for
 * the body so callers can pipe it.
 */
async function printFinalMessage(
  sessionId: string,
  workerName: string,
): Promise<void> {
  const file = eventsPath(sessionId);
  if (!fs.existsSync(file)) return;
  const lines = fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => l.trim());
  const events: TeamworkEvent[] = [];
  for (const l of lines) {
    try {
      events.push(JSON.parse(l) as TeamworkEvent);
    } catch {
      // ignore
    }
  }
  const candidate = events
    .filter((e) => e.kind === "message" && e.by === workerName)
    .pop();
  if (!candidate) return;
  const text = (candidate as { text?: string }).text ?? "";
  process.stdout.write(text);
  if (!text.endsWith("\n")) process.stdout.write("\n");
}
