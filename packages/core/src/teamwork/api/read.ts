import {
  readTeamworkEvents as readEventsInternal,
  type TeamworkEvent,
  type ContextTeamworkEvent,
  type ReadTeamworkEventsPagination,
  type ThreadTeamworkEvent,
} from "../internal/store/events.js";
import { reduceTeamworkSessionMetadata } from "../internal/store/teamwork-session-metadata.js";
import {
  collectThreadTimeline,
  reduceThreads,
  type ThreadState,
} from "../internal/store/thread-state.js";
import { normalizeThreadKey } from "../internal/store/schema.js";
import type { TeamworkSessionMetadata } from "../internal/store/schema.js";
import { readForumTeamworkEvents } from "./assert.js";
import { resolveTeamworkSession } from "./resolve.js";
import type { TeamworkSessionAddressOptions } from "./types.js";

/**
 * Cursor pagination options. Omitting all of them returns every event,
 * preserving the read-all default for existing callers.
 */
export interface ReadTeamworkEventsOptions
  extends TeamworkSessionAddressOptions,
    ReadTeamworkEventsPagination {}

export async function readTeamworkEvents(
  opts: ReadTeamworkEventsOptions,
): Promise<TeamworkEvent[]> {
  const ref = resolveTeamworkSession({
    sessionId: opts.sessionId,
    ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
    ...(opts.projectKey !== undefined ? { projectKey: opts.projectKey } : {}),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  return readEventsInternal(opts.sessionId, ref.project, {
    ...(opts.afterSeq !== undefined ? { afterSeq: opts.afterSeq } : {}),
    ...(opts.beforeSeq !== undefined ? { beforeSeq: opts.beforeSeq } : {}),
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
  });
}

export async function readTeamworkSessionMetadata(
  opts: TeamworkSessionAddressOptions,
): Promise<TeamworkSessionMetadata> {
  const events = await readTeamworkEvents(opts);
  return reduceTeamworkSessionMetadata(events);
}

export async function listForumThreads(
  opts: TeamworkSessionAddressOptions,
): Promise<ThreadState[]> {
  const ref = resolveTeamworkSession({
    sessionId: opts.sessionId,
    ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
    ...(opts.projectKey !== undefined ? { projectKey: opts.projectKey } : {}),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  const events = await readForumTeamworkEvents(
    opts.sessionId,
    ref.project,
    "forum",
  );
  return reduceThreads(events);
}

export async function showThread(
  opts: TeamworkSessionAddressOptions & { thread: string },
): Promise<(ThreadTeamworkEvent | ContextTeamworkEvent)[]> {
  const ref = resolveTeamworkSession({
    sessionId: opts.sessionId,
    ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
    ...(opts.projectKey !== undefined ? { projectKey: opts.projectKey } : {}),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  const events = await readForumTeamworkEvents(
    opts.sessionId,
    ref.project,
    "thread",
  );
  return collectThreadTimeline(events, normalizeThreadKey(opts.thread));
}
