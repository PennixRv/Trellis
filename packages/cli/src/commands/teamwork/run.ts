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
import type { ReasoningEffort } from "./profiles.js";
import { createTeamworkSession } from "./create.js";
import { teamworkSessionRm } from "./rm.js";
import { teamworkSessionSend } from "./send.js";
import { teamworkSessionSpawn } from "./spawn.js";
import { teamworkSessionKill } from "./kill.js";
import { resolveTeamworkSessionTextBody } from "./text-body.js";
import { parseTeammateContent, type TeamworkResult } from "./result.js";
import { sessionDir, eventsPath, workerFile } from "./store/paths.js";
import { readLastSeq, type TeamworkEvent } from "./store/events.js";
import { watchEvents } from "./store/watch.js";

export interface RunOptions {
  /** Optional Teamwork Session name; auto-generated if omitted. */
  name?: string;
  agent?: string;
  provider?: Provider;
  as?: string;
  cwd?: string;
  model?: string;
  profile?: string;
  configuration?: string;
  reasoningEffort?: ReasoningEffort;
  files?: string[];
  jsonls?: string[];
  message?: string;
  textFile?: string;
  stdin?: boolean;
  json?: boolean;
  /** Per-worker timeout (defaults to 5m if not specified). */
  timeoutMs?: number;
}

export async function teamworkSessionRun(opts: RunOptions): Promise<void> {
  const name = opts.name ?? `run-${crypto.randomBytes(4).toString("hex")}`;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const result: TeamworkResult = {
    schemaVersion: 1,
    kind: "trellis_result",
    mode: "interactive",
    association: { sessionId: name },
    execution: {
      status: "error",
      stopped: true,
      ...(opts.provider ? { provider: opts.provider } : {}),
      ...(opts.model ? { requestedModel: opts.model } : {}),
    },
    reports: [],
    semanticValidation: "not_run",
    disposition: "not_applicable",
  };
  let workerName: string | null = null;
  let created = false;
  let succeeded = false;
  let failure: unknown;
  let finalText: string | undefined;
  try {
    const text = await resolveTeamworkSessionTextBody(
      { text: opts.message, textFile: opts.textFile, stdin: opts.stdin },
      {
        required: true,
        missingMessage:
          "No text provided (use --message, --text-file, or --stdin)",
        emptyMessage: "Empty message",
      },
    );
    await createTeamworkSession(name, {
      by: "main",
      cwd: opts.cwd,
      ephemeral: true,
      origin: "run",
      quiet: true,
    });
    created = true;
    // A provider can finish or fail before spawn returns.
    const sinceSeq = await readLastSeq(name);
    const spawned = await teamworkSessionSpawn(name, {
      agent: opts.agent,
      provider: opts.provider,
      as: opts.as,
      cwd: opts.cwd,
      model: opts.model,
      profile: opts.profile,
      configuration: opts.configuration,
      reasoningEffort: opts.reasoningEffort,
      timeoutMs,
      files: opts.files,
      jsonls: opts.jsonls,
      quiet: true,
    });
    workerName = spawned.worker;
    result.association.worker = workerName;
    result.execution.provider = spawned.provider ?? opts.provider;
    result.execution.requestedModel = spawned.model ?? opts.model;

    await teamworkSessionSend(name, {
      as: "main",
      to: workerName,
      text,
      quiet: true,
    });

    await waitForDone(name, workerName, timeoutMs, sinceSeq);
    result.execution.status = "completed";
    result.reports.push({
      association: { worker: workerName },
      report: null,
      validation: "failed",
    });
    const report = parseTeammateContent(
      await readFinalMessage(name, workerName),
    );
    result.reports[0].report = report;
    result.reports[0].validation = "passed";
    finalText = report.answer;
    succeeded = report.status === "complete";
  } catch (error) {
    failure = error;
    const message = error instanceof Error ? error.message : String(error);
    result.execution.reason = message;
    if (result.execution.status !== "completed")
      result.execution.status = /timeout/i.test(message)
        ? "timeout"
        : /killed before done/.test(message)
          ? "cancelled"
          : "error";
    if (result.reports[0]) result.reports[0].error = message;
  } finally {
    if (succeeded) {
      // Clean removal — the Teamwork Session served its purpose.
      try {
        const preview = await teamworkSessionRm(name, { force: true });
        if (preview.eligible)
          await teamworkSessionRm(name, {
            force: true,
            confirm: preview.digest,
          });
        else {
          result.diagnosticsPath = sessionDir(name);
          process.stderr.write(
            `Teamwork Session retained: ${preview.blockers.join("; ")}\n`,
          );
        }
      } catch (error) {
        failure = error;
        succeeded = false;
        result.execution.status = "uncertain";
        result.execution.stopped = false;
        result.execution.reason =
          error instanceof Error ? error.message : String(error);
      }
    }
    if (!succeeded && created) {
      if (
        workerName &&
        (fs.existsSync(workerFile(name, workerName, "pid")) ||
          fs.existsSync(workerFile(name, workerName, "worker-pid")))
      ) {
        try {
          await teamworkSessionKill(name, { as: workerName });
        } catch (error) {
          result.execution.stopped = false;
          process.stderr.write(
            `Teammate stop unconfirmed: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
      }
      // Failure path: keep the Teamwork Session so the user can inspect events.jsonl,
      // logs, pid state etc. The ephemeral flag remains, so a later
      // `teamwork prune --ephemeral` will still clean it.
      const dir = sessionDir(name);
      result.diagnosticsPath = dir;
      process.stderr.write(
        `Teamwork Session kept for inspection: ${dir}\n` +
          `(ephemeral — will be removed by \`teamwork prune --ephemeral\`)\n`,
      );
      process.exitCode = 1;
    }
  }
  if (!succeeded) process.exitCode = 1;
  if (opts.json) console.log(JSON.stringify(result));
  else if (failure) throw failure;
  else if (finalText !== undefined) {
    process.stdout.write(finalText);
    if (!finalText.endsWith("\n")) process.stdout.write("\n");
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
  sinceSeq: number,
): Promise<void> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    for await (const ev of watchEvents(
      sessionId,
      {
        self: "main",
        kind: ["done", "error", "killed"],
      },
      { signal: abort.signal, sinceSeq },
    )) {
      if (
        ev.by !== workerName &&
        ev.by !== `supervisor:${workerName}` &&
        !("worker" in ev && ev.worker === workerName)
      )
        continue;
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
async function readFinalMessage(
  sessionId: string,
  workerName: string,
): Promise<string> {
  const file = eventsPath(sessionId);
  if (!fs.existsSync(file))
    throw new Error("Teammate produced no final message");
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
  if (!candidate) throw new Error("Teammate produced no final message");
  const text = (candidate as { text?: string }).text ?? "";
  if (!text.trim()) throw new Error("Teammate produced an empty final message");
  return text;
}
