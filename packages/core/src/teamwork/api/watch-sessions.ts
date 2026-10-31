import type { TeamworkEvent } from "../internal/store/events.js";
import type { TeamworkEventFilter } from "../internal/store/filter.js";
import {
  sessionDir,
  listSessionIdsInProject,
} from "../internal/store/paths.js";
import {
  GLOBAL_PROJECT_KEY,
  type TeamworkSessionRef,
  type TeamworkSessionScope,
} from "../internal/store/schema.js";
import { watchEvents } from "../internal/store/watch.js";

/** Stable per-session cursor key: `${scope}/${project}/${name}`. */
export type TeamworkSessionCursorKey = string;

/** Per-session resume cursor for the cross-session watcher. */
export type TeamworkSessionCursor = Record<TeamworkSessionCursorKey, number>;

export function teamworkSessionCursorKey(ref: TeamworkSessionRef): TeamworkSessionCursorKey {
  return `${ref.scope}/${ref.project}/${ref.name}`;
}

export interface WatchTeamworkSessionsInput {
  /** Project bucket scope, or the global bucket. */
  scope: { projectKey: string } | "global";
  filter?: TeamworkEventFilter;
  /** Per-session resume cursors keyed by {@link teamworkSessionCursorKey}. */
  cursor?: TeamworkSessionCursor;
  signal?: AbortSignal;
  /**
   * When a Teamwork Session is discovered after the watcher starts, read its
   * backlog from seq 0. Default false (tail from end).
   */
  fromStartNewTeamworkSessions?: boolean;
  /** TeamworkSession-discovery poll interval in ms. Default 500. */
  discoveryIntervalMs?: number;
}

export interface CrossTeamworkEvent {
  sessionId: TeamworkSessionRef;
  event: TeamworkEvent;
  /** Snapshot of the full cursor map after applying this event. */
  cursor: TeamworkSessionCursor;
}

function resolveScope(input: WatchTeamworkSessionsInput): {
  project: string;
  scope: TeamworkSessionScope;
} {
  if (input.scope === "global") {
    return { project: GLOBAL_PROJECT_KEY, scope: "global" };
  }
  return { project: input.scope.projectKey, scope: "project" };
}

/**
 * Watch every Teamwork Session in a project (or the global) scope and fan its
 * events into a single stream. Sessions created inside the scope after
 * the watcher starts are discovered dynamically. Each yielded event
 * carries a snapshot of the per-session cursor map so consumers can
 * checkpoint `(session ID, seq)` — delivery is at-least-once.
 */
export async function* watchTeamworkSessions(
  input: WatchTeamworkSessionsInput,
): AsyncGenerator<CrossTeamworkEvent, void, unknown> {
  const { project, scope } = resolveScope(input);
  const filter = input.filter ?? {};
  const discoveryIntervalMs = input.discoveryIntervalMs ?? 500;
  const cursor: TeamworkSessionCursor = { ...(input.cursor ?? {}) };

  const queue: CrossTeamworkEvent[] = [];
  const active = new Set<TeamworkSessionCursorKey>();
  const controllers = new Map<TeamworkSessionCursorKey, AbortController>();
  const tasks = new Set<Promise<void>>();
  let wake: (() => void) | null = null;
  let done = false;
  let discovery: ReturnType<typeof setInterval> | undefined;
  let cleaned = false;

  const notify = (): void => {
    if (wake) {
      const w = wake;
      wake = null;
      w();
    }
  };

  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    for (const controller of controllers.values()) {
      controller.abort();
    }
    controllers.clear();
    if (discovery !== undefined) {
      clearInterval(discovery);
      discovery = undefined;
    }
    input.signal?.removeEventListener("abort", abortHandler);
  };

  const abortHandler = (): void => {
    done = true;
    cleanup();
    notify();
  };
  input.signal?.addEventListener("abort", abortHandler);

  let initialScan = true;

  const startWatcher = (name: string): void => {
    const ref: TeamworkSessionRef = {
      name,
      scope,
      project,
      dir: sessionDir(name, project),
    };
    const key = teamworkSessionCursorKey(ref);
    if (active.has(key)) return;
    active.add(key);
    const controller = new AbortController();
    controllers.set(key, controller);
    const resume = cursor[key];
    const watchOpts: {
      signal?: AbortSignal;
      fromStart?: boolean;
      sinceSeq?: number;
      project?: string;
    } = { project };
    watchOpts.signal = controller.signal;
    if (resume !== undefined) {
      watchOpts.sinceSeq = resume;
    } else {
      // No prior cursor: newly discovered sessions read their backlog; sessions
      // discovered later follow `fromStartNewTeamworkSessions`.
      watchOpts.fromStart = initialScan
        ? true
        : (input.fromStartNewTeamworkSessions ?? false);
    }
    const task = (async () => {
      try {
        for await (const ev of watchEvents(name, filter, watchOpts)) {
          cursor[key] = ev.seq;
          queue.push({ sessionId: ref, event: ev, cursor: { ...cursor } });
          notify();
        }
      } catch {
        // Watcher ended (abort / fs error). Discovery may restart it
        // while the parent watcher is still active.
      } finally {
        active.delete(key);
        controllers.delete(key);
      }
    })();
    tasks.add(task);
    void task.finally(() => {
      tasks.delete(task);
    });
  };

  for (const name of listSessionIdsInProject(project)) {
    startWatcher(name);
  }
  initialScan = false;

  discovery = setInterval(() => {
    if (done) return;
    for (const name of listSessionIdsInProject(project)) {
      startWatcher(name);
    }
  }, discoveryIntervalMs);

  try {
    while (!done) {
      if (input.signal?.aborted) return;
      if (queue.length > 0) {
        yield queue.shift() as CrossTeamworkEvent;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    // Drain anything that landed during the final wake.
    while (queue.length > 0) {
      yield queue.shift() as CrossTeamworkEvent;
    }
  } finally {
    done = true;
    cleanup();
    await Promise.allSettled([...tasks]);
  }
}
