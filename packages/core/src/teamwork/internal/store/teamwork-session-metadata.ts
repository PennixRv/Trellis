import {
  isTeamworkMetadataEvent,
  isContextEvent,
  isCreateEvent,
  type TeamworkEvent,
} from "./events.js";
import {
  asContextEntries,
  asStringArray,
  contextEntryKey,
  type TeamworkSessionMetadata,
  type TeamworkSessionType,
  type ContextEntry,
} from "./schema.js";

/**
 * Single source of truth for projecting Teamwork Session metadata from its
 * event stream.
 *
 * Covers:
 *   - create event metadata (type, description, labels, context)
 *   - `kind:"context", target:"session"` add/delete projection
 *   - `kind:"teamwork", action:"title"` set/clear projection
 */
export function reduceTeamworkSessionMetadata(
  events: TeamworkEvent[],
): TeamworkSessionMetadata {
  let type: TeamworkSessionType = "chat";
  let description: string | undefined;
  let labels: string[] | undefined;
  let title: string | undefined;
  const contextMap = new Map<string, ContextEntry>();

  const addEntries = (entries: ContextEntry[] | undefined): void => {
    if (!entries) return;
    for (const entry of entries) {
      contextMap.set(contextEntryKey(entry), entry);
    }
  };
  const deleteEntries = (entries: ContextEntry[] | undefined): void => {
    if (!entries) return;
    for (const entry of entries) {
      contextMap.delete(contextEntryKey(entry));
    }
  };

  for (const ev of events) {
    if (isCreateEvent(ev)) {
      type = normalizeTeamworkSessionType(ev.type);
      if (typeof ev.description === "string") description = ev.description;
      labels = asStringArray(ev.labels) ?? labels;
      const initial = asContextEntries(ev.context);
      contextMap.clear();
      addEntries(initial);
      continue;
    }

    if (isContextEvent(ev) && ev.target === "session") {
      const entries = asContextEntries(ev.context);
      if (ev.action === "add") addEntries(entries);
      else if (ev.action === "delete") deleteEntries(entries);
      continue;
    }

    if (isTeamworkMetadataEvent(ev) && ev.action === "title") {
      const next = ev.title;
      if (typeof next === "string" && next.length > 0) title = next;
      else if (next === null || next === "") title = undefined;
      continue;
    }
  }

  const context = contextMap.size > 0 ? [...contextMap.values()] : undefined;

  return {
    type,
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(context !== undefined ? { context } : {}),
    ...(labels !== undefined ? { labels } : {}),
  };
}

/** Project a single create event into Teamwork Session metadata. */
export function metadataFromCreateEvent(
  create: TeamworkEvent | undefined,
): TeamworkSessionMetadata {
  if (!create || !isCreateEvent(create)) return { type: "chat" };
  return reduceTeamworkSessionMetadata([create]);
}

function normalizeTeamworkSessionType(value: unknown): TeamworkSessionType {
  if (value === "forum") return "forum";
  return "chat";
}
