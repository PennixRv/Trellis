import fs from "node:fs";
import { isSupervisorProcess } from "./guard.js";
import { readProcessIdentity } from "./process-identity.js";

import { appendEvent } from "./store/events.js";
import { withLock } from "./store/lock.js";
import {
  resolveExistingTeamworkSession,
  workerFile,
  workerLockPath,
} from "./store/paths.js";
import { parseTeamworkSessionScope } from "./store/schema.js";

export interface KillOptions {
  as: string;
  force?: boolean;
  scope?: string;
  /** Internal project bucket for session removal across projects. */
  project?: string;
}

const POLL_INTERVAL_MS = 100;
const KILL_GRACE_MS = 8000; // generous: supervisor's own grace is ~6s

export async function teamworkSessionKill(
  sessionId: string,
  opts: KillOptions,
): Promise<void> {
  const project =
    opts.project ??
    resolveExistingTeamworkSession(sessionId, {
      scope: parseTeamworkSessionScope(opts.scope),
    }).project;
  // Take the teammate lock so kill ↔ spawn can't race: spawn won't claim a
  // stale pid file while we're tearing it down; we won't try to kill a
  // teammate whose pid file is mid-creation.
  return withLock(
    workerLockPath(sessionId, opts.as, project),
    () => killLocked(sessionId, opts, project),
    { maxWaitMs: KILL_GRACE_MS + 2000 },
  );
}

async function killLocked(
  sessionId: string,
  opts: KillOptions,
  project: string,
): Promise<void> {
  const pidPath = workerFile(sessionId, opts.as, "pid", project);
  const workerPidPath = workerFile(sessionId, opts.as, "worker-pid", project);
  if (!fs.existsSync(pidPath) && !fs.existsSync(workerPidPath)) {
    throw new Error(
      `Teammate '${opts.as}' not running in Teamwork Session '${sessionId}'`,
    );
  }
  const supervisorPid = fs.existsSync(pidPath)
    ? Number(fs.readFileSync(pidPath, "utf-8").trim())
    : 0;
  if (
    fs.existsSync(pidPath) &&
    (!Number.isSafeInteger(supervisorPid) || supervisorPid <= 0)
  ) {
    throw new Error("Cannot verify supervisor PID; recovery files preserved");
  }
  if (
    supervisorPid &&
    alive(supervisorPid) &&
    !isSupervisorProcess(supervisorPid, sessionId, opts.as)
  ) {
    throw new Error(
      "Cannot verify supervisor process identity; recovery files preserved",
    );
  }
  if (!supervisorPid || !alive(supervisorPid)) {
    await terminateRecordedChild(sessionId, opts.as, project);
    await appendEvent(
      sessionId,
      {
        kind: "error",
        by: `cli:kill`,
        message: `supervisor lost (pid ${supervisorPid})`,
        worker: opts.as,
      },
      project,
    );
    cleanupFiles(sessionId, opts.as, project);
    return;
  }

  if (opts.force) {
    // Also kill the teammate process so it doesn't become an orphan.
    await terminateRecordedChild(sessionId, opts.as, project);
    signalSupervisor(supervisorPid, "SIGKILL", sessionId, opts.as);
    // SIGKILL skips supervisor's onShutdown handler, so the `killed`
    // event would never make it into events.jsonl. Write it from here
    // so forensic readers see the kill happened.
    await appendEvent(
      sessionId,
      {
        kind: "killed",
        by: "cli:kill",
        worker: opts.as,
        reason: "explicit-kill",
        signal: "SIGKILL",
      },
      project,
    );
  } else {
    signalSupervisor(supervisorPid, "SIGTERM", sessionId, opts.as);
  }

  // Wait for supervisor to actually exit
  const deadline = Date.now() + KILL_GRACE_MS;
  while (alive(supervisorPid) && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
  }

  if (alive(supervisorPid)) {
    // Grace expired — force kill. Supervisor's onShutdown handler never
    // got to fire (or it deadlocked), so we write the `killed` event from
    // the CLI side to keep the Teamwork Session log truthful.
    await terminateRecordedChild(sessionId, opts.as, project);
    signalSupervisor(supervisorPid, "SIGKILL", sessionId, opts.as);
    const forcedDeadline = Date.now() + KILL_GRACE_MS;
    while (alive(supervisorPid) && Date.now() < forcedDeadline)
      await sleep(POLL_INTERVAL_MS);
    if (alive(supervisorPid))
      throw new Error("Supervisor did not exit; recovery files preserved");
    await appendEvent(
      sessionId,
      {
        kind: "killed",
        by: "cli:kill",
        worker: opts.as,
        reason: "explicit-kill",
        signal: "SIGKILL",
        detail: "grace expired, supervisor SIGKILL'd by CLI",
      },
      project,
    );
  }

  await terminateRecordedChild(sessionId, opts.as, project);
  cleanupFiles(sessionId, opts.as, project);
}

function signalSupervisor(
  pid: number,
  signal: NodeJS.Signals,
  sessionId: string,
  worker: string,
): void {
  if (!alive(pid)) return;
  if (!isSupervisorProcess(pid, sessionId, worker))
    throw new Error(
      "Cannot verify supervisor process identity; recovery files preserved",
    );
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function alive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function terminateRecordedChild(
  sessionId: string,
  worker: string,
  project: string,
): Promise<void> {
  const pidPath = workerFile(sessionId, worker, "worker-pid", project);
  if (!fs.existsSync(pidPath)) return;
  const pid = Number(fs.readFileSync(pidPath, "utf-8").trim());
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error(
      "Cannot verify orphan teammate PID; recovery files preserved",
    );
  if (!alive(pid)) return;
  const identityPath = workerFile(
    sessionId,
    worker,
    "worker-identity",
    project,
  );
  const expected = fs.existsSync(identityPath)
    ? fs.readFileSync(identityPath, "utf-8").trim()
    : undefined;
  if (!expected || readProcessIdentity(pid) !== expected)
    throw new Error(
      "Cannot verify orphan teammate process identity; recovery files preserved",
    );
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  const deadline = Date.now() + KILL_GRACE_MS;
  while (alive(pid) && Date.now() < deadline) await sleep(POLL_INTERVAL_MS);
  if (alive(pid))
    throw new Error("Orphan teammate did not exit; recovery files preserved");
}

function cleanupFiles(
  sessionId: string,
  worker: string,
  project: string,
): void {
  // Keep `log` (forensic), `session-id` / `thread-id` (resume).
  // `system-prompt.md` may carry a large injected context; on Windows the
  // SIGKILL'd supervisor cannot run its own cleanup, so the CLI removes it
  // here too (unconditionally, so a prior oversized run leaves nothing).
  for (const suffix of [
    "pid",
    "worker-pid",
    "worker-identity",
    "config",
    "system-prompt.md",
    "spawnlock",
  ]) {
    try {
      fs.unlinkSync(workerFile(sessionId, worker, suffix, project));
    } catch {
      // already gone
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
