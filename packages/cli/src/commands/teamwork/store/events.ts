/**
 * Teamwork event local module.
 *
 * Canonical types, reducers, and seq-allocating append come from
 * `@pennixrv/trellis-core`. Supervisor / spawn / kill still import
 * `appendEvent` from here so their call sites stay stable; the
 * implementation is core's, including torn-tail seq recovery.
 *
 * `readTeamworkEvents` stays a CLI-local full-file reader until those
 * callers move to core's paginated API.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";

import {
  reduceTeamworkSessionMetadata,
  type TeamworkEvent,
  type TeamworkSessionMetadata,
} from "@pennixrv/trellis-core/teamwork";

import { eventsPath } from "./paths.js";

export {
  TEAMWORK_EVENT_KINDS,
  parseTeamworkEventKind,
  parseTeamworkEventKinds,
  isCreateEvent,
  isThreadEvent,
  isContextEvent,
  isTeamworkMetadataEvent,
  reduceTeamworkSessionMetadata,
  appendEvent,
  readLastSeq,
} from "@pennixrv/trellis-core/teamwork";

export type {
  TeamworkEvent,
  TeamworkEventKind,
  CreateTeamworkEvent,
  MessageTeamworkEvent,
  ThreadTeamworkEvent,
  ContextTeamworkEvent,
  TeamworkMetadataEvent,
  SpawnedTeamworkEvent,
  KilledTeamworkEvent,
  DoneTeamworkEvent,
  ErrorTeamworkEvent,
  ProgressTeamworkEvent,
  SupervisorWarningTeamworkEvent,
  AppendablePartial,
} from "@pennixrv/trellis-core/teamwork";

export async function readTeamworkEvents(
  name: string,
  project?: string,
): Promise<TeamworkEvent[]> {
  const file = eventsPath(name, project);
  if (!fs.existsSync(file)) return [];
  const text = await fsp.readFile(file, "utf-8");
  const events: TeamworkEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as TeamworkEvent);
    } catch {
      continue;
    }
  }
  return events;
}

/**
 * Read Teamwork Session metadata from disk. Delegates to the core
 * reducer so list / messages / forum commands share projection
 * semantics with downstream consumers.
 */
export async function readTeamworkSessionMetadata(
  name: string,
  project?: string,
): Promise<TeamworkSessionMetadata> {
  return reduceTeamworkSessionMetadata(await readTeamworkEvents(name, project));
}
