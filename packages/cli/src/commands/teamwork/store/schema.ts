/**
 * TeamworkSession schema re-exports.
 *
 * Canonical source: `@pennixrv/trellis-core/teamwork`. This module is
 * kept as a thin pass-through during the supervisor/wait migration so
 * CLI runtime code (supervisor, spawn, kill, wait) can continue to
 * import from a stable local path while command files migrate to the
 * core public API directly.
 */

export {
  GLOBAL_PROJECT_KEY,
  TEAMWORK_SESSION_TYPES,
  THREAD_ACTIONS,
  parseTeamworkSessionScope,
  parseTeamworkSessionType,
  parseThreadAction,
  normalizeThreadKey,
  asStringArray,
  asContextEntries,
  buildContextEntries,
} from "@pennixrv/trellis-core/teamwork";

export type {
  TeamworkSessionScope,
  TeamworkSessionType,
  TeamworkSessionRef,
  TeamworkSessionMetadata,
  ContextEntry,
  FileContextEntry,
  RawContextEntry,
  ThreadAction,
  EventOrigin,
} from "@pennixrv/trellis-core/teamwork";

/**
 * CSV parser kept colocated with the schema for CLI command files that
 * trim comma-separated label / target lists. Pure helper — does not
 * touch Teamwork Session storage.
 */
export function parseCsv(value: string | undefined): string[] | undefined {
  const out = value
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return out && out.length > 0 ? out : undefined;
}
