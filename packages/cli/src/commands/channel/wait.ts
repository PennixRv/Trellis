import { watchWorkers } from "@pennixrv/trellis-core/channel";
import { parseChannelKinds, readLastSeq } from "./store/events.js";
import { resolveExistingChannelRef } from "./store/paths.js";
import {
  normalizeThreadKey,
  parseCsv,
  parseChannelScope,
  parseThreadAction,
} from "./store/schema.js";
import { watchEvents, type WatchFilter } from "./store/watch.js";

export interface WaitOptions {
  as: string;
  timeoutMs?: number;
  /** Replay only events whose durable sequence is greater than this barrier. */
  afterSeq?: number;
  from?: string;
  /** Wait for named worker lifecycle transitions, independent of authors. */
  workers?: string;
  kind?: string;
  to?: string;
  scope?: string;
  thread?: string;
  action?: string;
  includeProgress?: boolean;
  /** Wait until every named author or worker has matched. */
  all?: boolean;
}

const TIMEOUT_EXIT_CODE = 124;

/** Read the current durable event sequence without appending an event. */
export async function channelBarrier(
  channelName: string,
  opts: Pick<WaitOptions, "scope"> = {},
): Promise<number> {
  const ref = resolveExistingChannelRef(channelName, {
    scope: parseChannelScope(opts.scope),
  });
  return readLastSeq(channelName, ref.project);
}

export async function channelWait(
  channelName: string,
  opts: WaitOptions,
): Promise<void> {
  const ref = resolveExistingChannelRef(channelName, {
    scope: parseChannelScope(opts.scope),
  });
  // Capture a durable barrier before constructing the watcher. Events that
  // arrive after this read are replayed by `sinceSeq`, including events
  // written during watcher setup; this avoids the EOF race where a fast
  // worker finishes before the async generator starts tailing.
  const sinceSeq =
    opts.afterSeq ?? (await readLastSeq(channelName, ref.project));
  const fromList = parseCsv(opts.from);
  const workerList = parseCsv(opts.workers);

  if (opts.workers !== undefined) {
    if (!workerList?.length)
      throw new Error("--workers requires a non-empty worker CSV");
    if (
      [opts.from, opts.kind, opts.to, opts.thread, opts.action].some(
        (v) => v !== undefined,
      ) ||
      opts.includeProgress
    ) {
      throw new Error(
        "--workers cannot be combined with event filters (--from/--kind/--to/--thread/--action/--include-progress)",
      );
    }
  }
  if (opts.all && !workerList?.length && !fromList?.length) {
    throw new Error("--all requires --from <a,b,...> or --workers <a,b,...>");
  }

  const filter: WatchFilter = {
    self: opts.as,
    from: fromList,
    kind: parseChannelKinds(opts.kind),
    to: opts.to ?? opts.as, // default: broadcasts to me + explicit-to-me
    thread: opts.thread ? normalizeThreadKey(opts.thread) : undefined,
    action: opts.action ? parseThreadAction(opts.action) : undefined,
    includeProgress: opts.includeProgress,
  };

  const abort = new AbortController();
  const timer = opts.timeoutMs
    ? setTimeout(() => abort.abort(), opts.timeoutMs)
    : undefined;

  // --all: wait for one matching event from EACH named agent before returning.
  // Without --all: return on the first matching event (legacy semantics).
  const pending = workerList
    ? new Set(workerList)
    : opts.all
      ? new Set(fromList)
      : null;

  try {
    if (workerList && pending) {
      let previous = new Map<string, boolean>();
      for await (const workers of watchWorkers({
        channel: channelName,
        scope: parseChannelScope(opts.scope),
        projectKey: ref.project,
        includeTerminal: true,
        sinceSeq,
        signal: abort.signal,
      })) {
        if (abort.signal.aborted) break;
        for (const worker of workers) {
          if (
            pending.has(worker.workerId) &&
            worker.terminal &&
            !previous.get(worker.workerId) &&
            worker.lastSeq > sinceSeq
          ) {
            console.log(JSON.stringify(worker));
            pending.delete(worker.workerId);
            if (!opts.all || pending.size === 0) return;
          }
        }
        previous = new Map(
          workers.map((worker) => [worker.workerId, worker.terminal]),
        );
      }
    } else {
      for await (const ev of watchEvents(channelName, filter, {
        signal: abort.signal,
        project: ref.project,
        sinceSeq,
      })) {
        console.log(JSON.stringify(ev));
        if (!pending) return;
        pending.delete(ev.by);
        if (pending.size === 0) return;
      }
    }
    // Iterator ended without satisfying — timeout
    if (pending && pending.size > 0) {
      process.stderr.write(
        `timeout: still waiting on ${[...pending].join(",")}\n`,
      );
    }
    process.exitCode = TIMEOUT_EXIT_CODE;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Parse a duration like "30s", "2m", "1h" into milliseconds. */
export function parseDuration(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = /^(\d+)(ms|s|m|h)?$/.exec(s.trim());
  if (!m) {
    throw new Error(`Invalid duration: ${s} (use Ns / Nm / Nh / Nms)`);
  }
  const n = Number(m[1]);
  switch (m[2] ?? "s") {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    default:
      return n * 1000;
  }
}
