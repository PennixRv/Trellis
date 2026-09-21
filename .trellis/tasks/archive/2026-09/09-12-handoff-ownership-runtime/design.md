# Design

## Boundary

The implementation belongs in the Trellis Python runtime shipped from
`packages/cli/src/templates/trellis/scripts/` and mirrored by `.trellis/scripts/`. It owns local
task/session control only. OpenViking, its Plugin, and Pennix handoff content remain outside this
repository's authority.

## Record

Store one bounded JSON record at
`.trellis/.runtime/handoff-ownership/<safe-task-id>/<safe-handoff-id>.json`. The runtime directory
is ignored and never included in Git. Required fields are:

```text
schema_version, kind, handoff_id, core_digest, task,
source_session_id, source_context_key,
consumer_session_id, consumer_context_key,
state, generation, fencing_token,
previous_event_digest, updated_at, integrity
```

`source_session_id` and `consumer_session_id` are provenance values supplied by the caller. The
current direct Trellis session identity is independently resolved and must match the actor for every
mutation. A `context_key` is not a substitute for a session id.

## State machine

```text
quiescing -> sealed -> retiring -> ready -> claimed -> consumed -> archived
     \-> withheld / stale / claim_conflict / recovery_required
```

`quiesce` creates a source-bound record. `retire` requires the source direct binding, expected
generation, handoff/core digest, and an archive observation (`not_required` or `observed`). It first
advances to `retiring` and writes a new token, removes and verifies the source session pointer, then
advances to `ready`. An interruption therefore cannot expose a claimable record; the same source may
retry `retire` from `retiring` with the new generation. `claim` accepts only `ready`, requires a task
path because a new session has no current task yet, validates task identity, and uses the existing
active-task writer for the target binding. `consume` and `archive` are separate idempotent transitions.

OpenViking archive observation is metadata only. Trellis does not call OpenViking or claim asynchronous
extraction. Pennix may select `not_required` for control-only handoff or `observed` only with an external
validated receipt.

## Concurrency and safety

Use one advisory lock per task/handoff record, expected state/generation/core digest CAS, atomic
same-directory write plus fsync, and a digest over the record excluding `integrity`. Re-read the
current direct session after acquiring the lock and before every write. If task identity or context
changes, abort. A stale source cannot mutate after retirement because its generation/token no longer
matches. A second consumer cannot claim `claimed` state.

If the process fails between target pointer write and ownership record write, recovery reports
`recovery_required` and does not silently allow another consumer. This is a local filesystem saga,
not a distributed transaction.

## CLI

Expose machine-readable JSON through `task.py ownership`:

```text
ownership quiesce --handoff-id ID --core-digest DIGEST --task PATH --source-session-id ID
ownership retire --handoff-id ID --core-digest DIGEST --expected-generation N --archive-observation VALUE
ownership claim --handoff-id ID --core-digest DIGEST --expected-generation N --task PATH
ownership consume --handoff-id ID --core-digest DIGEST --expected-generation N
ownership archive --handoff-id ID --core-digest DIGEST --expected-generation N
ownership status --handoff-id ID --core-digest DIGEST --json
```

Every mutating command requires `--explicit-user-request`. This is an accidental-use guard, not a
substitute for user authorization. Existing task and continuation commands remain compatible.
