import fs from "node:fs";

import {
  appendEvent,
  readTeamworkEvents,
  type TeamworkEvent,
} from "../internal/store/events.js";
import { workerFile } from "../internal/store/paths.js";
import type { TeamworkSessionScope } from "../internal/store/schema.js";
import { watchEvents } from "../internal/store/watch.js";
import {
  reduceWorkerRegistry,
  type WorkerState,
} from "../internal/store/worker-state.js";
import { resolveTeamworkSession } from "./resolve.js";

export interface ListWorkersInput {
  sessionId: string;
  scope?: TeamworkSessionScope;
  projectKey?: string;
  cwd?: string;
  /** Include `done` / `error` / `killed` / `crashed` workers. Default false. */
  includeTerminal?: boolean;
}

function resolve(input: {
  sessionId: string;
  scope?: TeamworkSessionScope;
  projectKey?: string;
  cwd?: string;
}): ReturnType<typeof resolveTeamworkSession> {
  return resolveTeamworkSession({
    sessionId: input.sessionId,
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    ...(input.projectKey !== undefined
      ? { projectKey: input.projectKey }
      : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
  });
}

/**
 * Project the durable worker registry for a Teamwork Session. Source of truth for CLI list /
 * status, daemon runtime cards, and tests — do not reparse event logs
 * independently.
 */
export async function listWorkers(
  input: ListWorkersInput,
): Promise<WorkerState[]> {
  const ref = resolve(input);
  const events = await readTeamworkEvents(input.sessionId, ref.project);
  const registry = reduceWorkerRegistry(events, ref);
  return input.includeTerminal
    ? registry.workers
    : registry.workers.filter((w) => !w.terminal);
}

export interface WatchWorkersInput extends ListWorkersInput {
  sinceSeq?: number;
  signal?: AbortSignal;
}

/**
 * Watch the durable worker registry. Yields a fresh registry snapshot
 * whenever a worker-relevant event lands. The first yield is the current
 * snapshot.
 */
export async function* watchWorkers(
  input: WatchWorkersInput,
): AsyncGenerator<WorkerState[], void, unknown> {
  const ref = resolve(input);
  const events = await readTeamworkEvents(input.sessionId, ref.project);

  const snapshot = (): WorkerState[] => {
    const registry = reduceWorkerRegistry(events, ref);
    return input.includeTerminal
      ? registry.workers
      : registry.workers.filter((w) => !w.terminal);
  };

  yield snapshot();

  const lastSeq = events.length > 0 ? events[events.length - 1].seq : 0;
  const watchOpts: {
    project: string;
    sinceSeq: number;
    signal?: AbortSignal;
  } = { project: ref.project, sinceSeq: input.sinceSeq ?? lastSeq };
  if (input.signal) watchOpts.signal = input.signal;

  for await (const ev of watchEvents(
    input.sessionId,
    { includeNonMeaningful: true, includeProgress: false },
    watchOpts,
  )) {
    events.push(ev);
    yield snapshot();
  }
}

export interface WorkerRuntimeObservation {
  workerId: string;
  /** Supervisor pid from `<worker>.pid`. */
  pid?: number;
  /** Worker child pid from `<worker>.worker-pid`. */
  workerPid?: number;
  supervisorAlive?: boolean;
  workerAlive?: boolean;
  observedAt: string;
  source: "local-pid-files";
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPidFile(path: string): number | undefined {
  try {
    const n = Number(fs.readFileSync(path, "utf-8").trim());
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

export interface ProbeWorkerRuntimeInput {
  sessionId: string;
  scope?: TeamworkSessionScope;
  projectKey?: string;
  cwd?: string;
}

/**
 * Host-local runtime observation. Reads `<worker>.pid` /
 * `<worker>.worker-pid` files and checks OS liveness. This is NOT
 * durable event truth — `reduceWorkerRegistry` must never read pid
 * files. Only valid on the machine that owns the supervisor files.
 */
export async function probeWorkerRuntime(
  input: ProbeWorkerRuntimeInput,
): Promise<WorkerRuntimeObservation[]> {
  const ref = resolve(input);
  const events = await readTeamworkEvents(input.sessionId, ref.project);
  const registry = reduceWorkerRegistry(events, ref);
  const observedAt = new Date().toISOString();
  return registry.workers.map((w) => {
    const pid = readPidFile(
      workerFile(input.sessionId, w.workerId, "pid", ref.project),
    );
    const workerPid = readPidFile(
      workerFile(input.sessionId, w.workerId, "worker-pid", ref.project),
    );
    const obs: WorkerRuntimeObservation = {
      workerId: w.workerId,
      observedAt,
      source: "local-pid-files",
    };
    if (pid !== undefined) {
      obs.pid = pid;
      obs.supervisorAlive = pidAlive(pid);
    }
    if (workerPid !== undefined) {
      obs.workerPid = workerPid;
      obs.workerAlive = pidAlive(workerPid);
    }
    return obs;
  });
}

export interface ReconcileWorkerLivenessInput extends ProbeWorkerRuntimeInput {
  now?: () => Date;
  /** Append the proposed terminal events. Default false (no durable writes). */
  appendTerminalEvents?: boolean;
}

export interface ReconcileWorkerLivenessResult {
  observations: WorkerRuntimeObservation[];
  proposedEvents: TeamworkEvent[];
  appended: TeamworkEvent[];
}

/**
 * Reconcile durable worker state against host-local pid files. Reports
 * observations and the durable events it would propose. Only writes when
 * `appendTerminalEvents` is true — the default performs no durable
 * writes. Valid only on the machine that owns the supervisor files.
 */
export async function reconcileWorkerLiveness(
  input: ReconcileWorkerLivenessInput,
): Promise<ReconcileWorkerLivenessResult> {
  const ref = resolve(input);
  const events = await readTeamworkEvents(input.sessionId, ref.project);
  const registry = reduceWorkerRegistry(events, ref);
  const observations = await probeWorkerRuntime(input);
  const obsById = new Map(observations.map((o) => [o.workerId, o]));
  const now = (input.now ?? (() => new Date()))();

  const proposedEvents: TeamworkEvent[] = [];
  for (const w of registry.workers) {
    if (w.terminal) continue;
    const obs = obsById.get(w.workerId);
    // A non-terminal worker whose supervisor pid is gone is a crash that
    // never wrote a terminal event.
    if (obs?.supervisorAlive === false) {
      proposedEvents.push({
        seq: 0,
        ts: now.toISOString(),
        kind: "error",
        by: `supervisor:${w.workerId}`,
        worker: w.workerId,
        message: "supervisor process not alive (reconciled)",
        synthesized: true,
      } as TeamworkEvent);
    }
  }

  const appended: TeamworkEvent[] = [];
  if (input.appendTerminalEvents) {
    for (const ev of proposedEvents) {
      const { seq: _seq, ts: _ts, ...partial } = ev;
      void _seq;
      void _ts;
      appended.push(
        await appendEvent(
          input.sessionId,
          partial as Parameters<typeof appendEvent>[1],
          ref.project,
        ),
      );
    }
  }

  return { observations, proposedEvents, appended };
}
