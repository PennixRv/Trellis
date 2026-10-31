import {
  appendEvent,
  type TeamworkMetadataEvent,
} from "../internal/store/events.js";
import { resolveTeamworkSession } from "./resolve.js";
import type {
  ClearTeamworkSessionTitleOptions,
  SetTeamworkSessionTitleOptions,
} from "./types.js";

export async function setTeamworkSessionTitle(
  opts: SetTeamworkSessionTitleOptions,
): Promise<TeamworkMetadataEvent> {
  if (!opts.title || opts.title.length === 0) {
    throw new Error("Teamwork Session title must not be empty (use clearTeamworkSessionTitle)");
  }
  const ref = resolveTeamworkSession({
    sessionId: opts.sessionId,
    ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
    ...(opts.projectKey !== undefined ? { projectKey: opts.projectKey } : {}),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  const event = await appendEvent(
    opts.sessionId,
    {
      kind: "teamwork",
      action: "title",
      by: opts.by,
      title: opts.title,
      ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
      ...(opts.meta !== undefined ? { meta: opts.meta } : {}),
    },
    ref.project,
  );
  return event as TeamworkMetadataEvent;
}

export async function clearTeamworkSessionTitle(
  opts: ClearTeamworkSessionTitleOptions,
): Promise<TeamworkMetadataEvent> {
  const ref = resolveTeamworkSession({
    sessionId: opts.sessionId,
    ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
    ...(opts.projectKey !== undefined ? { projectKey: opts.projectKey } : {}),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  const event = await appendEvent(
    opts.sessionId,
    {
      kind: "teamwork",
      action: "title",
      by: opts.by,
      title: null,
      ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
      ...(opts.meta !== undefined ? { meta: opts.meta } : {}),
    },
    ref.project,
  );
  return event as TeamworkMetadataEvent;
}
