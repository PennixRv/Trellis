# Design

## Ownership Chain

```text
create CLI/env -> create event.ownerSessionId
worker adapter -> session_bound event
event reducer -> WorkerState.sessionIds + lifecycle/activity
channel list/workers JSON -> CCH read-only consumer
```

The event layer owns types, event-kind registration, and replay. The core API
owns create and worker projection. The CLI owns argument parsing and environment
fallback. Supervisor stdout owns the adapter-to-event bridge. No consumer
reparses event JSON or reads private runtime files.

## Contracts

`ownerSessionId` is optional, immutable, opaque, and compared exactly. The
create API receives it from the CLI; the CLI uses the explicit option first,
then `CODEX_THREAD_ID`, then `CODEX_SESSION_ID`. Only non-forum channels are
automatically associated. Existing channels without the field remain
unowned.

`session_bound` is a durable event with `worker` and non-empty `sessionId`.
The reducer appends a session once in event order, preserves all later distinct
IDs, and exposes an empty array when no event exists. It does not replace the
latest ID or maintain a second index.

`channel list --owner-session` performs exact replay filtering. Project
`--all-projects` enumerates all project buckets; global remains a separate
scope. `channel workers --project-key` passes the already-supported core
`projectKey` through the CLI. The existing `project` summary field remains the
machine-readable bucket identifier for compatibility.

## Compatibility and Failure

Old event logs replay with no owner and empty `sessionIds`. Missing optional
fields do not alter existing lifecycle output. Invalid or empty session-bound
payloads are ignored by the reducer; they never create phantom workers. CLI
argument errors remain descriptive and use the existing scope parser.

## Non-goals

Do not implement cost aggregation, tmux rendering, CCH cache semantics,
workflow task ownership, sidecar migration, rollout scanning, or automatic
Channel cleanup changes.
