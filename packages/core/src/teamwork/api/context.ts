import {
  appendEvent,
  readTeamworkEvents,
  type ContextTeamworkEvent,
} from "../internal/store/events.js";
import { reduceTeamworkSessionMetadata } from "../internal/store/teamwork-session-metadata.js";
import {
  normalizeThreadKey,
  type ContextEntry,
} from "../internal/store/schema.js";
import {
  reduceThreads,
  type ThreadState,
} from "../internal/store/thread-state.js";
import { readForumTeamworkEvents } from "./assert.js";
import { resolveTeamworkSession } from "./resolve.js";
import type {
  ContextMutationOptions,
  ThreadContextMutationOptions,
} from "./types.js";

async function appendContextEvent(
  ref: { name: string; project: string },
  by: string,
  action: "add" | "delete",
  target: "session" | "thread",
  context: ContextEntry[],
  thread: string | undefined,
  origin: ContextMutationOptions["origin"],
  meta: ContextMutationOptions["meta"],
): Promise<ContextTeamworkEvent> {
  if (!context || context.length === 0) {
    throw new Error("context must contain at least one entry");
  }
  const event = await appendEvent(
    ref.name,
    {
      kind: "context",
      by,
      target,
      action,
      context,
      ...(thread !== undefined ? { thread } : {}),
      ...(origin !== undefined ? { origin } : {}),
      ...(meta !== undefined ? { meta } : {}),
    },
    ref.project,
  );
  return event as ContextTeamworkEvent;
}

export async function addTeamworkSessionContext(
  opts: ContextMutationOptions,
): Promise<ContextTeamworkEvent> {
  const ref = resolveTeamworkSession({
    sessionId: opts.sessionId,
    ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
    ...(opts.projectKey !== undefined ? { projectKey: opts.projectKey } : {}),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  return appendContextEvent(
    { name: opts.sessionId, project: ref.project },
    opts.by,
    "add",
    "session",
    opts.context,
    undefined,
    opts.origin,
    opts.meta,
  );
}

export async function deleteTeamworkSessionContext(
  opts: ContextMutationOptions,
): Promise<ContextTeamworkEvent> {
  const ref = resolveTeamworkSession({
    sessionId: opts.sessionId,
    ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
    ...(opts.projectKey !== undefined ? { projectKey: opts.projectKey } : {}),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  return appendContextEvent(
    { name: opts.sessionId, project: ref.project },
    opts.by,
    "delete",
    "session",
    opts.context,
    undefined,
    opts.origin,
    opts.meta,
  );
}

export async function listTeamworkSessionContext(
  opts: {
    sessionId: string;
    scope?: ContextMutationOptions["scope"];
    projectKey?: string;
    cwd?: string;
  },
): Promise<ContextEntry[]> {
  const ref = resolveTeamworkSession({
    sessionId: opts.sessionId,
    ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
    ...(opts.projectKey !== undefined ? { projectKey: opts.projectKey } : {}),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  const events = await readTeamworkEvents(opts.sessionId, ref.project);
  const meta = reduceTeamworkSessionMetadata(events);
  return meta.context ?? [];
}

export async function addThreadContext(
  opts: ThreadContextMutationOptions,
): Promise<ContextTeamworkEvent> {
  const ref = resolveTeamworkSession({
    sessionId: opts.sessionId,
    ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
    ...(opts.projectKey !== undefined ? { projectKey: opts.projectKey } : {}),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  const thread = normalizeThreadKey(opts.thread);
  const states = reduceThreads(
    await readForumTeamworkEvents(opts.sessionId, ref.project, "context add"),
  );
  assertKnownThread(states, thread, opts.sessionId);
  return appendContextEvent(
    { name: opts.sessionId, project: ref.project },
    opts.by,
    "add",
    "thread",
    opts.context,
    thread,
    opts.origin,
    opts.meta,
  );
}

export async function deleteThreadContext(
  opts: ThreadContextMutationOptions,
): Promise<ContextTeamworkEvent> {
  const ref = resolveTeamworkSession({
    sessionId: opts.sessionId,
    ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
    ...(opts.projectKey !== undefined ? { projectKey: opts.projectKey } : {}),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  const thread = normalizeThreadKey(opts.thread);
  const states = reduceThreads(
    await readForumTeamworkEvents(opts.sessionId, ref.project, "context delete"),
  );
  assertKnownThread(states, thread, opts.sessionId);
  return appendContextEvent(
    { name: opts.sessionId, project: ref.project },
    opts.by,
    "delete",
    "thread",
    opts.context,
    thread,
    opts.origin,
    opts.meta,
  );
}

export async function listThreadContext(opts: {
  sessionId: string;
  thread: string;
  scope?: ContextMutationOptions["scope"];
  projectKey?: string;
  cwd?: string;
}): Promise<ContextEntry[]> {
  const ref = resolveTeamworkSession({
    sessionId: opts.sessionId,
    ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
    ...(opts.projectKey !== undefined ? { projectKey: opts.projectKey } : {}),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  const events = await readForumTeamworkEvents(
    opts.sessionId,
    ref.project,
    "context list",
  );
  const states = reduceThreads(events);
  const key = normalizeThreadKey(opts.thread);
  for (const state of states) {
    if (state.thread === key || state.aliases.includes(key)) {
      return state.context ?? [];
    }
  }
  return [];
}

function assertKnownThread(
  states: ThreadState[],
  thread: string,
  sessionId: string,
): void {
  const found = states.some(
    (state) => state.thread === thread || state.aliases.includes(thread),
  );
  if (!found) {
    throw new Error(`Thread '${thread}' not found in Teamwork Session '${sessionId}'.`);
  }
}
