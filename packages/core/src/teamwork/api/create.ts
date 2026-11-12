import fs from "node:fs";

import {
  appendEvent,
  type CreateTeamworkEvent,
} from "../internal/store/events.js";
import {
  ensureBucketMarker,
} from "../internal/store/paths.js";
import { parseTeamworkSessionType } from "../internal/store/schema.js";
import { resolveTeamworkSession } from "./resolve.js";
import type { CreateTeamworkSessionOptions } from "./types.js";

/**
 * Create a new Teamwork Session. Existing evidence must first be retired by
 * its purpose-aware owner; force is retained for input compatibility only.
 */
export async function createTeamworkSession(
  opts: CreateTeamworkSessionOptions,
): Promise<CreateTeamworkEvent> {
  const ref = resolveTeamworkSession({
    sessionId: opts.sessionId,
    scope: opts.scope ?? "project",
    ...(opts.projectKey !== undefined ? { projectKey: opts.projectKey } : {}),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    forCreate: true,
  });
  const sessionType = parseTeamworkSessionType(opts.type);
  const dir = ref.dir;

  if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
    throw new Error(
      `Teamwork Session '${opts.sessionId}' already exists at ${dir}. Review native rm preview/confirmation before reusing its name; --force does not remove evidence.`,
    );
  }

  ensureBucketMarker(ref.project);

  const cwd = opts.cwd ?? process.cwd();

  const event = await appendEvent(
    opts.sessionId,
    {
      kind: "create",
      by: opts.by,
      cwd,
      scope: ref.scope,
      type: sessionType,
      ...(opts.task ? { task: opts.task } : {}),
      ...(opts.project ? { project: opts.project } : {}),
      ...(opts.labels && opts.labels.length > 0 ? { labels: opts.labels } : {}),
      ...(opts.description ? { description: opts.description } : {}),
      ...(opts.context && opts.context.length > 0
        ? { context: opts.context }
        : {}),
      ...(opts.ephemeral ? { ephemeral: true } : {}),
      ...(opts.origin ? { origin: opts.origin } : {}),
      ...(opts.meta ? { meta: opts.meta } : {}),
    },
    ref.project,
  );
  return event as CreateTeamworkEvent;
}
