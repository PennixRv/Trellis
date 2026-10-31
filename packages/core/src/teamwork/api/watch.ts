import {
  watchEvents,
  type WatchFilter,
} from "../internal/store/watch.js";
import type { TeamworkEvent } from "../internal/store/events.js";
import { resolveTeamworkSession } from "./resolve.js";
import type { TeamworkSessionAddressOptions } from "./types.js";

export interface WatchTeamworkSessionOptions extends TeamworkSessionAddressOptions {
  filter?: WatchFilter;
  signal?: AbortSignal;
  fromStart?: boolean;
  sinceSeq?: number;
}

export function watchTeamworkEvents(
  opts: WatchTeamworkSessionOptions,
): AsyncGenerator<TeamworkEvent, void, unknown> {
  const ref = resolveTeamworkSession({
    sessionId: opts.sessionId,
    ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
    ...(opts.projectKey !== undefined ? { projectKey: opts.projectKey } : {}),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  return watchEvents(opts.sessionId, opts.filter ?? {}, {
    project: ref.project,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    ...(opts.fromStart !== undefined ? { fromStart: opts.fromStart } : {}),
    ...(opts.sinceSeq !== undefined ? { sinceSeq: opts.sinceSeq } : {}),
  });
}
