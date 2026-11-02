# Task Continuity and Ownership Transfer

This contract covers `packages/cli/src/templates/trellis/scripts/common/task_continuity.py` and its CLI entry points in `task.py`. The source template and dogfood copy at `.trellis/scripts/` must remain byte-identical.

## Responsibility

Trellis owns task and phase facts. `continuity` exposes a read-only projection and an explicit freshness capture. `transfer` fences task writes and moves the task pointer between direct sessions. Neither command advances a phase, accepts phase output, completes a task, or manages a session package's retention lifecycle.

The runtime records are stored under `.trellis/.runtime/continuity/` and `.trellis/.runtime/task-ownership/`, keyed by repository-relative task path. This distinguishes date-prefixed tasks that share a slug and keeps ownership checks addressable when `task.json` is unreadable. The task ID is checked against the ownership record whenever the task data is available; renaming remains blocked while the record exists. These files are derived local state, not task history or additional task status fields.

## `task.py continuity`

```text
task.py continuity show
task.py continuity capture --expected-source-digest <digest|absent>
```

Both commands require one unambiguous, direct current-task binding. The projection contains:

- `task`: task ID, repository-relative path, and task status.
- `phase`: current phase ID, route revision, input revision, and per-phase status, artifact/result revisions, result reference, outcome, evidence references, and acceptance.
- `evidence_digest`: SHA-256 of the sorted phase evidence references.
- `git`: `HEAD`, branch, cleanliness, status digest, and content digest. The content digest covers the binary diff against `HEAD` and untracked file contents; `.trellis/session-handoffs/` is excluded because package creation is independent of task continuity.

`show` returns `ready` when the saved source digest matches, `stale` when it differs, and `absent` when no capture exists. Missing or ambiguous task/session facts return a withheld result. `capture` uses compare-and-set on the previously observed digest (or `absent`), recomputes the projection before writing, and increments its local generation. It never edits `task.json`.

Continuity errors are `TASK_CONTINUITY_ABSENT`, `TASK_CONTINUITY_STALE`, `TASK_CONTINUITY_WITHHELD`, and `TASK_CONTINUITY_WRITE_FAILED`.

## `task.py transfer`

```text
task.py transfer <status|quiesce|seal|retire|claim|consume|release> \
  --task-id <id> --task-path <path> --package-id <id> \
  --package-digest <sha256-hex> [--expected-generation <n>] \
  [--explicit-user-request]
```

All operations identify the same task and package. The digest is the package core's SHA-256 hex value without a prefix. `status` is read-only. Every ownership mutation requires `--explicit-user-request` and the expected generation. The source and target must each have a direct session identity; fallback identity is insufficient.

| Expected state | Operation | Result state | Generation |
| --- | --- | --- | ---: |
| No record | `quiesce` | `quiescing` | 1 |
| `quiescing` | `seal` | `sealed` | 2 |
| `sealed` | `retire` | `ready` after the source pointer is removed and verified | 3 |
| `ready` | `claim` | `claimed` after the target pointer is set and verified | 4 |
| `claimed` | `claim` by another direct session | `claimed` after target takeover and pointer verification | current generation + 1 |
| `claimed` | `consume` | `consumed` | current generation + 1 |

`retire` and `claim` write an intermediate recovery state before changing a session pointer. A failed pointer compare-and-set or verification returns `TASK_TRANSFER_RECOVERY_REQUIRED`; only the recorded direct session may recover that in-progress operation. After a claim reaches stable `claimed`, a different direct session may take over only with an explicit user request and the current expected generation. While holding the ownership lock, Trellis first clears the prior target pointer if it still references this task; an unreadable or unwritable pointer leaves ownership `claimed` and retryable. Trellis then records the new target and increments the generation before setting and verifying the new target pointer. A failed update remains recoverable by the newly recorded target. The previous target can no longer consume or mutate the task. This is an explicit retarget operation, not timeout-based liveness detection. `release` is available to the source before target claim from `quiescing`, `sealed`, or `recovery_required`; it restores and verifies the source pointer, then removes the ownership record. Release does not advance the generation and remains available when the continuity snapshot has gone stale.

Except for `release`, each mutation checks the captured continuity digest and original route snapshot; the package adapter additionally checks package freshness before operations that depend on its captured snapshot. Task-record writes and active-task pointer changes serialize through the per-task ownership lock. While ownership is pending, writes are fenced; after `consumed`, only the target session bound to that task may mutate it. A task ID cannot change while its ownership record remains, so task rename is withheld until task completion or cancellation clears that record. A task's phase state remains an independent task concern.

Ownership errors are `TASK_TRANSFER_ABSENT`, `TASK_TRANSFER_ACTIVE`, `TASK_TRANSFER_INVALID_INPUT`, `TASK_TRANSFER_INVALID_TRANSITION`, `TASK_TRANSFER_NOT_AUTHORIZED`, `TASK_TRANSFER_RECOVERY_REQUIRED`, `TASK_TRANSFER_STALE_CONTINUITY`, `TASK_TRANSFER_STALE_GENERATION`, `TASK_TRANSFER_STALE_PACKAGE`, `TASK_TRANSFER_STALE_ROUTE`, `TASK_TRANSFER_TASK_ID_LOCKED`, `TASK_TRANSFER_WITHHELD`, and `TASK_TRANSFER_WRITE_FAILED`.

## Integration boundary

`pennix-session-handoff` may call these commands as an optional adapter. Its package readiness, source lifecycle receipt, target admission, and retention archive remain separate from Trellis phase and task status. The adapter must not write task pointers or Trellis runtime records itself.
