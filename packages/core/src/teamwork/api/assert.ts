import {
  readTeamworkEvents,
  type TeamworkEvent,
} from "../internal/store/events.js";
import { reduceTeamworkSessionMetadata } from "../internal/store/teamwork-session-metadata.js";

export async function readForumTeamworkEvents(
  sessionId: string,
  project: string,
  operation: string,
): Promise<TeamworkEvent[]> {
  const events = await readTeamworkEvents(sessionId, project);
  const metadata = reduceTeamworkSessionMetadata(events);
  if (metadata.type !== "forum") {
    throw new Error(
      `Teamwork Session '${sessionId}' is type '${metadata.type}'. '${operation}' requires a forum Teamwork Session.`,
    );
  }
  return events;
}
