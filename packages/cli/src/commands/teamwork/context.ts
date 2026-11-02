import {
  addTeamworkSessionContext,
  addThreadContext,
  buildContextEntries,
  deleteTeamworkSessionContext,
  deleteThreadContext,
  listTeamworkSessionContext,
  listThreadContext,
  type TeamworkSessionScope,
} from "@pennixrv/trellis-core/teamwork";

import { parseTeamworkSessionScope } from "./store/schema.js";

export interface ContextMutateCliOptions {
  as?: string;
  scope?: string;
  thread?: string;
  file?: string[];
  raw?: string[];
}

export interface ContextListCliOptions {
  scope?: string;
  thread?: string;
  raw?: boolean;
}

export async function teamworkSessionContextAdd(
  sessionId: string,
  opts: ContextMutateCliOptions,
): Promise<void> {
  const context = buildContextEntries(opts.file, opts.raw);
  if (!context) {
    throw new Error("Provide at least one --file <abs-path> or --raw <text>");
  }
  const scope: TeamworkSessionScope | undefined = parseTeamworkSessionScope(
    opts.scope,
  );
  const event = opts.thread
    ? await addThreadContext({
        sessionId: sessionId,
        by: opts.as ?? "main",
        thread: opts.thread,
        context,
        ...(scope !== undefined ? { scope } : {}),
        origin: "cli",
      })
    : await addTeamworkSessionContext({
        sessionId: sessionId,
        by: opts.as ?? "main",
        context,
        ...(scope !== undefined ? { scope } : {}),
        origin: "cli",
      });
  console.log(JSON.stringify(event));
}

export async function teamworkSessionContextDelete(
  sessionId: string,
  opts: ContextMutateCliOptions,
): Promise<void> {
  const context = buildContextEntries(opts.file, opts.raw);
  if (!context) {
    throw new Error("Provide at least one --file <abs-path> or --raw <text>");
  }
  const scope: TeamworkSessionScope | undefined = parseTeamworkSessionScope(
    opts.scope,
  );
  const event = opts.thread
    ? await deleteThreadContext({
        sessionId: sessionId,
        by: opts.as ?? "main",
        thread: opts.thread,
        context,
        ...(scope !== undefined ? { scope } : {}),
        origin: "cli",
      })
    : await deleteTeamworkSessionContext({
        sessionId: sessionId,
        by: opts.as ?? "main",
        context,
        ...(scope !== undefined ? { scope } : {}),
        origin: "cli",
      });
  console.log(JSON.stringify(event));
}

export async function teamworkSessionContextList(
  sessionId: string,
  opts: ContextListCliOptions,
): Promise<void> {
  const scope: TeamworkSessionScope | undefined = parseTeamworkSessionScope(
    opts.scope,
  );
  const entries = opts.thread
    ? await listThreadContext({
        sessionId: sessionId,
        thread: opts.thread,
        ...(scope !== undefined ? { scope } : {}),
      })
    : await listTeamworkSessionContext({
        sessionId: sessionId,
        ...(scope !== undefined ? { scope } : {}),
      });
  if (opts.raw) {
    for (const entry of entries) console.log(JSON.stringify(entry));
    return;
  }
  if (entries.length === 0) {
    console.log("(no context)");
    return;
  }
  for (const entry of entries) {
    if (entry.type === "file") {
      console.log(`file ${entry.path}`);
    } else {
      const oneLine = entry.text.replace(/\s+/g, " ").trim();
      const display =
        oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
      console.log(`raw  ${display}`);
    }
  }
}
