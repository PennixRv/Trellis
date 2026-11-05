import { parseTeamworkEventKinds, readTeamworkEvents } from "./store/events.js";
import { buildInteractiveResult } from "./result.js";
import { resolveExistingTeamworkSession } from "./store/paths.js";
import {
  normalizeThreadKey,
  parseCsv,
  parseTeamworkSessionScope,
  parseThreadAction,
} from "./store/schema.js";
import { watchEvents, type WatchFilter } from "./store/watch.js";

export interface WaitOptions {
  as: string;
  timeoutMs?: number;
  from?: string;
  kind?: string;
  to?: string;
  scope?: string;
  thread?: string;
  action?: string;
  includeProgress?: boolean;
  /** Wait until every agent in --from has produced a matching event. */
  all?: boolean;
  /** One normalized final result, including content validation and input identity. */
  json?: boolean;
}

const TIMEOUT_EXIT_CODE = 124;

export async function teamworkSessionWait(
  sessionId: string,
  opts: WaitOptions,
): Promise<void> {
  const ref = resolveExistingTeamworkSession(sessionId, {
    scope: parseTeamworkSessionScope(opts.scope),
  });
  const fromList = parseCsv(opts.from);
  const resultWorker = fromList?.[0];
  if (
    opts.json &&
    (fromList?.length !== 1 ||
      opts.all ||
      opts.kind ||
      opts.thread ||
      opts.action ||
      opts.includeProgress)
  )
    throw new Error(
      "--json requires exactly one --from worker and no event-kind, thread, action, progress or --all filter",
    );

  if (opts.all && (!fromList || fromList.length === 0)) {
    throw new Error("--all requires --from <a,b,...>");
  }

  const filter: WatchFilter = {
    self: opts.as,
    from: opts.json ? undefined : fromList,
    kind: opts.json
      ? ["turn_finished", "error", "killed"]
      : parseTeamworkEventKinds(opts.kind),
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
  const pending = opts.all ? new Set(fromList) : null;

  try {
    for await (const ev of watchEvents(sessionId, filter, {
      signal: abort.signal,
      project: ref.project,
    })) {
      if (opts.json) {
        if (!resultWorker) throw new Error("Missing result worker");
        const worker = resultWorker;
        if (ev.by !== worker && ev.by !== `supervisor:${worker}`) continue;
        const result = buildInteractiveResult(
          sessionId,
          worker,
          ev,
          await readTeamworkEvents(sessionId, ref.project),
        );
        console.log(JSON.stringify(result));
        if (
          result.execution.status !== "completed" ||
          result.reports.some(
            (item) =>
              item.validation !== "passed" ||
              item.report?.status !== "complete",
          )
        )
          process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(ev));
      if (!pending) return;
      pending.delete(ev.by);
      if (pending.size === 0) return;
    }
    // Iterator ended without satisfying — timeout
    if (pending && pending.size > 0) {
      process.stderr.write(
        `timeout: still waiting on ${[...pending].join(",")}\n`,
      );
    }
    process.exitCode = TIMEOUT_EXIT_CODE;
    if (opts.json)
      console.log(
        JSON.stringify({
          schemaVersion: 1,
          kind: "trellis_result",
          mode: "interactive",
          association: { sessionId, worker: resultWorker },
          execution: {
            status: "timeout",
            stopped: false,
            reason:
              "Wait deadline elapsed; the persistent worker remains owned by the session",
          },
          reports: [],
          semanticValidation: "not_run",
          disposition: "not_applicable",
        }),
      );
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
