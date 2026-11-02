import {
  buildContextEntries,
  createTeamworkSession as coreCreateTeamworkSession,
  resolveTeamworkSession,
  type TeamworkSessionScope,
  type TeamworkSessionType,
} from "@pennixrv/trellis-core/teamwork";

import {
  parseTeamworkSessionScope,
  parseTeamworkSessionType,
  parseCsv,
} from "./store/schema.js";

export interface CreateOptions {
  task?: string;
  project?: string;
  labels?: string;
  cwd?: string;
  scope?: string;
  type?: string;
  description?: string;
  contextFile?: string[];
  contextRaw?: string[];
  by?: string;
  force?: boolean;
  ephemeral?: boolean;
  /**
   * Optional mode marker for callers like `teamwork run` that produce
   * one-shot Teamwork Sessions. Stored as `meta.trellis.createMode` so the
   * create event keeps an `origin: "cli"` write entrypoint while still
   * exposing the mode for downstream consumers.
   */
  origin?: string;
}

export async function createTeamworkSession(
  name: string,
  opts: CreateOptions,
): Promise<void> {
  const scope: TeamworkSessionScope =
    parseTeamworkSessionScope(opts.scope) ?? "project";
  const sessionType: TeamworkSessionType = parseTeamworkSessionType(opts.type);
  const context = buildContextEntries(opts.contextFile, opts.contextRaw);
  const labels = parseCsv(opts.labels);

  const createMode = opts.origin;

  const event = await coreCreateTeamworkSession({
    sessionId: name,
    by: opts.by ?? "main",
    scope,
    type: sessionType,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.task ? { task: opts.task } : {}),
    ...(opts.project ? { project: opts.project } : {}),
    ...(labels ? { labels } : {}),
    ...(opts.description ? { description: opts.description } : {}),
    ...(context ? { context } : {}),
    ...(opts.ephemeral ? { ephemeral: true } : {}),
    ...(opts.force ? { force: true } : {}),
    origin: "cli",
    ...(createMode ? { meta: { trellis: { createMode } } } : {}),
  });

  console.log(
    `Created Teamwork Session '${name}' (${sessionType}) at ${sessionDirFromEvent(name, event.scope as TeamworkSessionScope, opts.cwd)}`,
  );
  if (opts.ephemeral) {
    process.stderr.write(
      "Ephemeral Teamwork Sessions are hidden from `teamwork list`; use `teamwork list --all` or `teamwork prune --ephemeral`\n",
    );
  }
}

function sessionDirFromEvent(
  name: string,
  scope: TeamworkSessionScope,
  cwd: string | undefined,
): string {
  const ref = resolveTeamworkSession({
    sessionId: name,
    scope,
    forCreate: true,
    ...(cwd !== undefined ? { cwd } : {}),
  });
  return ref.dir;
}
