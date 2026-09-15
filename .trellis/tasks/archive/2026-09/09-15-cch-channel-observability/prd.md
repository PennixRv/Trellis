# Expose Trellis owner and worker session projection for CCH

## Goal

Persist the Codex main-session ownership of durable Channels and every Codex
session ever bound to each worker, then expose those facts through the public
Channel CLI so CCH can aggregate only the current main session.

## Scope

- Add optional immutable `ownerSessionId` to non-forum Channel create events.
- Prefer explicit `--owner-session`; otherwise use non-empty
  `CODEX_THREAD_ID`, then `CODEX_SESSION_ID`; absent identity remains absent.
- Add exact owner filtering to `channel list`; project scope must support
  `--all-projects`, and JSON must retain the existing `project` bucket field
  plus `ownerSessionId`.
- Add a durable `session_bound` event emitted when an adapter obtains a worker
  session ID. Keep the existing resume sidecar, but do not make it a public
  observability source.
- Project deduplicated, occurrence-ordered `sessionIds: string[]` in
  `WorkerState`, defaulting to `[]`, and expose it in `channel workers --json`.
- Expose `channel workers --project-key <bucket>` so callers can disambiguate
  same-named project channels; global scope does not use this option.

## Constraints

- Channel event history and the existing worker reducer remain the source of
  truth. Do not add a registry, database, permission model, hashes, UUID shape
  restriction, or CCH-specific cost logic.
- Preserve old events and CLI behavior where the new optional fields are not
  present. Do not read rollout files, CCH state, worker sidecars, or task
  pointers from core.
- `starting` remains a supported lifecycle. Consumers must be able to see
  unknown future payload values without silently mapping them to idle or done.

## Acceptance Criteria

- [x] Create tests cover explicit owner, `CODEX_THREAD_ID`, `CODEX_SESSION_ID`,
  absent owner, forum behavior, and immutable replay.
- [x] List JSON tests cover exact owner isolation, project/all-projects and
  global scope, owner field, and project bucket output without widening table
  output.
- [x] Worker projection tests cover no session, duplicate session IDs, new IDs
  on the same worker, multiple workers, terminal workers, and stable empty
  arrays.
- [x] Worker CLI tests prove same channel names in separate project buckets
  are selected with `--project-key` and global scope remains separate.
- [x] Adapter/supervisor tests prove each non-empty persisted session ID emits
  a replayable `session_bound` event while resume sidecars still work.
- [x] Existing core, CLI, typecheck, lint, and package checks pass.
