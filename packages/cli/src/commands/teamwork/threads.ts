import {
  buildContextEntries,
  listForumThreads as coreListForumThreads,
  showThread as coreShowThread,
  postThread as corePostThread,
  reduceThreads,
  renameThread as coreRenameThread,
  type TeamworkSessionScope,
  type ContextTeamworkEvent,
  type ThreadTeamworkEvent,
} from "@mindfoldhq/trellis-core/teamwork";

import {
  parseTeamworkSessionScope,
  parseThreadAction,
  type ThreadAction,
} from "./store/schema.js";
import { parseCsv } from "./store/schema.js";
import { formatThreadBoard } from "./store/thread-state.js";
import { resolveTeamworkSessionTextBody } from "./text-body.js";

export interface ThreadPostOptions {
  as: string;
  action: string;
  thread?: string;
  title?: string;
  text?: string;
  stdin?: boolean;
  textFile?: string;
  description?: string;
  status?: string;
  labels?: string;
  assignees?: string;
  summary?: string;
  scope?: string;
  contextFile?: string[];
  contextRaw?: string[];
}

export interface ForumOptions {
  scope?: string;
  status?: string;
  raw?: boolean;
}

export interface ThreadShowOptions {
  scope?: string;
  raw?: boolean;
}

export interface ThreadRenameOptions {
  as: string;
  scope?: string;
}

export async function teamworkSessionThreadPost(
  sessionId: string,
  opts: ThreadPostOptions,
): Promise<void> {
  const parsed = parseThreadAction(opts.action);
  if (parsed === "rename") {
    throw new Error(
      "Use `trellis teamwork thread rename <sessionId> <old> <new>` instead of `post rename`.",
    );
  }
  const action = parsed as Exclude<ThreadAction, "rename">;

  const context = buildContextEntries(opts.contextFile, opts.contextRaw);
  const labels = parseCsv(opts.labels);
  const assignees = parseCsv(opts.assignees);
  const text = await resolveTeamworkSessionTextBody(opts, {
    required: false,
    missingMessage: "No text provided (use --text, --stdin, or --text-file)",
    emptyMessage: "Empty thread event text",
  });

  const scope: TeamworkSessionScope | undefined = parseTeamworkSessionScope(
    opts.scope,
  );

  const event = await corePostThread({
    sessionId: sessionId,
    by: opts.as,
    action,
    thread: opts.thread ?? "",
    ...(scope !== undefined ? { scope } : {}),
    ...(opts.title ? { title: opts.title } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.status ? { status: opts.status } : {}),
    ...(labels ? { labels } : {}),
    ...(assignees ? { assignees } : {}),
    ...(opts.summary ? { summary: opts.summary } : {}),
    ...(context ? { context } : {}),
    origin: "cli",
  });
  console.log(JSON.stringify(event));
}

export async function teamworkSessionForumList(
  sessionId: string,
  opts: ForumOptions,
): Promise<void> {
  const scope: TeamworkSessionScope | undefined = parseTeamworkSessionScope(
    opts.scope,
  );
  const states = (
    await coreListForumThreads({
      sessionId: sessionId,
      ...(scope !== undefined ? { scope } : {}),
    })
  ).filter((state) => (opts.status ? state.status === opts.status : true));
  if (opts.raw) {
    for (const state of states) console.log(JSON.stringify(state));
    return;
  }
  for (const line of formatThreadBoard(states)) console.log(line);
}

export async function teamworkSessionThreadShow(
  sessionId: string,
  threadKey: string,
  opts: ThreadShowOptions,
): Promise<void> {
  const scope: TeamworkSessionScope | undefined = parseTeamworkSessionScope(
    opts.scope,
  );
  const events = await coreShowThread({
    sessionId: sessionId,
    thread: threadKey,
    ...(scope !== undefined ? { scope } : {}),
  });
  if (opts.raw) {
    for (const ev of events) console.log(JSON.stringify(ev));
    return;
  }
  if (events.length === 0) {
    throw new Error(
      `Thread '${threadKey}' not found in Teamwork Session '${sessionId}'`,
    );
  }
  const state = reduceThreads(events)[0];
  console.log(
    `${state.thread} [${state.status}] ${state.title ?? ""}`.trimEnd(),
  );
  if (state.description) console.log(`description: ${state.description}`);
  if (state.labels.length > 0) console.log(`labels: ${state.labels.join(",")}`);
  if (state.assignees.length > 0) {
    console.log(`assignees: ${state.assignees.join(",")}`);
  }
  if (state.summary) console.log(`summary: ${state.summary}`);
  for (const ev of events) printTimelineEvent(ev);
}

export async function teamworkSessionThreadRename(
  sessionId: string,
  oldThread: string,
  newThread: string,
  opts: ThreadRenameOptions,
): Promise<void> {
  const scope: TeamworkSessionScope | undefined = parseTeamworkSessionScope(
    opts.scope,
  );
  const event = await coreRenameThread({
    sessionId: sessionId,
    by: opts.as,
    thread: oldThread,
    newThread,
    ...(scope !== undefined ? { scope } : {}),
    origin: "cli",
  });
  console.log(JSON.stringify(event));
}

function printTimelineEvent(
  ev: ThreadTeamworkEvent | ContextTeamworkEvent,
): void {
  const ts = ev.ts.slice(0, 19).replace("T", " ");
  if (ev.kind === "thread") {
    const action = ev.action ?? "?";
    const text = ev.text ? ` ${ev.text}` : "";
    console.log(`  ${ts} ${action} by=${ev.by}${text}`);
    return;
  }
  // context event
  const action = ev.action ?? "?";
  console.log(`  ${ts} context-${action} by=${ev.by}`);
}
