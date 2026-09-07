/**
 * `channel run` — one-shot wrapper for short tasks: create an ephemeral
 * channel, spawn one worker, send a single prompt, wait for `done`,
 * print the worker's final message, and clean up.
 *
 * Scope (decided in plan-r2):
 *   - single worker only (multi-worker scenarios use the manual
 *     `create --ephemeral` → N × spawn → wait --all → prune pattern)
 *   - failure preserves the channel and prints its path so the user can
 *     inspect; success removes it
 */

import crypto from "node:crypto";
import fs from "node:fs";

import type { Provider } from "./adapters/index.js";
import { createChannel } from "./create.js";
import { channelRm } from "./rm.js";
import { channelSend } from "./send.js";
import { channelSpawn } from "./spawn.js";
import { channelDir, eventsPath } from "./store/paths.js";
import { readLastSeq, type ChannelEvent } from "./store/events.js";
import { watchEvents } from "./store/watch.js";

export interface RunOptions {
  /** Optional channel name; auto-generated if omitted. */
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

export async function channelRun(opts: RunOptions): Promise<void> {
  const name = opts.name ?? `run-${crypto.randomBytes(4).toString("hex")}`;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;

  await createChannel(name, {
    by: "main",
    cwd: opts.cwd,
    ephemeral: true,
    origin: "run",
  });

  // Capture the barrier before spawning. A provider may fail or finish while
  // the supervisor is starting; taking it after spawn would hide that event.
  const sinceSeq = await readLastSeq(name);

  let workerName: string | null = null;
  let succeeded = false;
  try {
    const spawned = await channelSpawn(name, {
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

    await channelSend(name, {
      as: "main",
      to: workerName,
      text: opts.message,
      textFile: opts.textFile,
      stdin: opts.stdin,
    });

    await waitForDone(name, workerName, timeoutMs, sinceSeq);
    await printFinalMessage(name, workerName);
    succeeded = true;
  } finally {
    if (succeeded) {
      // Clean removal — the channel served its purpose.
      await channelRm(name, { force: true });
    } else {
      // Failure path: keep the channel so the user can inspect events.jsonl,
      // logs, pid state etc. The ephemeral flag remains, so a later
      // `channel prune --ephemeral` will still clean it.
      const dir = channelDir(name);
      process.stderr.write(
        `channel kept for inspection: ${dir}\n` +
          `(ephemeral — will be removed by \`channel prune --ephemeral\`)\n`,
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
  channelName: string,
  workerName: string,
  timeoutMs: number,
  sinceSeq: number,
): Promise<void> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    for await (const ev of watchEvents(
      channelName,
      {
        self: "main",
        from: [workerName],
      },
      { signal: abort.signal, sinceSeq },
    )) {
      if (ev.kind === "done") return;
      if (ev.kind === "error") {
        const msg = (ev as { message?: string }).message ?? "(no message)";
        throw new Error(`worker ${workerName} reported error: ${msg}`);
      }
      if (ev.kind === "killed") {
        const reason = (ev as { reason?: string }).reason ?? "(unknown)";
        throw new Error(`worker ${workerName} killed before done: ${reason}`);
      }
    }
    throw new Error(`timeout waiting for ${workerName} done`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Print the worker's final user-visible message. Stdout is reserved for
 * the body so callers can pipe it.
 */
async function printFinalMessage(
  channelName: string,
  workerName: string,
): Promise<void> {
  const file = eventsPath(channelName);
  if (!fs.existsSync(file)) return;
  const lines = fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => l.trim());
  const events: ChannelEvent[] = [];
  for (const l of lines) {
    try {
      events.push(JSON.parse(l) as ChannelEvent);
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
