import fs from "node:fs";
import path from "node:path";

import {
  appendEvent,
  type CreateTeamworkEvent,
} from "../internal/store/events.js";
import {
  sessionDir,
  ensureBucketMarker,
  eventsPath,
} from "../internal/store/paths.js";
import { parseTeamworkSessionType } from "../internal/store/schema.js";
import { resolveTeamworkSession } from "./resolve.js";
import type { CreateTeamworkSessionOptions } from "./types.js";

/**
 * Create a new Teamwork Session. Throws when it already exists unless
 * `force` is set, in which case the existing Teamwork Session directory is wiped
 * before the create event is appended.
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
  const events = eventsPath(opts.sessionId, ref.project);
  const dir = ref.dir;

  if (fs.existsSync(events) && !opts.force) {
    throw new Error(
      `Teamwork Session '${opts.sessionId}' already exists at ${dir}. Use --force to overwrite.`,
    );
  }

  if (opts.force && fs.existsSync(dir)) {
    await forceCleanTeamworkSession(opts.sessionId, ref.project);
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

async function forceCleanTeamworkSession(name: string, project: string): Promise<void> {
  const dir = sessionDir(name, project);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const f of entries) {
    if (!f.endsWith(".pid")) continue;
    const pidFile = path.join(dir, f);
    let pid = 0;
    try {
      pid = Number(fs.readFileSync(pidFile, "utf-8").trim());
    } catch {
      continue;
    }
    if (pid && pidAlive(pid)) {
      try {
        process.kill(pid, "SIGTERM");
        const deadline = Date.now() + 1500;
        while (pidAlive(pid) && Date.now() < deadline) {
          await sleep(50);
        }
        if (pidAlive(pid)) process.kill(pid, "SIGKILL");
      } catch {
        // already dead
      }
    }
  }

  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    process.stderr.write(
      `[trellis teamwork create --force] warning: failed to fully clean ${dir}: ${err instanceof Error ? err.message : err}\n`,
    );
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
