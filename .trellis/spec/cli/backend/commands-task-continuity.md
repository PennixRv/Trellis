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
task.py transfer <status|quiesce|seal|retire|claim|consume|release|reconcile> \
  --task-id <id> --task-path <path> --package-id <id> \
  --package-digest <sha256-hex> [--expected-generation <n>] \
  [--expected-continuity-digest <sha256-hex>] [--include-current] \
  [--explicit-user-request]
```

All operations identify the same task and package. The digest is the package core's SHA-256 hex value without a prefix. `status` is read-only. Every ownership mutation requires `--explicit-user-request` and the expected generation. The source and target must each have a direct session identity; fallback identity is insufficient.

`task.py current --json` exposes the direct `session_source` even when this session has no task pointer; `source` continues to describe the task binding. Do not start a task merely to obtain its session identity.

`transfer status --include-current` additionally returns `current_projection` and its `current_continuity_digest` without binding the task to the reader. This is the native inspection path for an unbound target to reconcile task, phase, evidence, and Git facts before explicitly pinning a recovery. Ordinary `status` remains available without recomputing the projection.

| Expected state | Operation | Result state | Generation |
| --- | --- | --- | ---: |
| No record | `quiesce` | `quiescing` | 1 |
| `quiescing` | `seal` | `sealed` | 2 |
| `sealed` | `retire` | `ready` after the source pointer is removed and verified | 3 |
| `ready` | `claim` | `claimed` after the target pointer is set and verified | 4 |
| `sealed` | `claim` with an explicitly reconciled live digest | `claimed` after retiring the source pointer and verifying the target pointer | current generation + 1 |
| `claimed` | `claim` by another direct session | `claimed` after target takeover and pointer verification | current generation + 1 |
| `claimed` | `consume` | `consumed` | current generation + 1 |
| `consumed` | `reconcile` by the recorded target with an explicit live digest | `consumed`, with only the acknowledged target digest updated | current generation + 1 |

Sealed-source recovery requires `--expected-continuity-digest` equal to the recomputed live projection, an explicit user request, the current generation, the same package, and the original route snapshot. It never impersonates the source. Trellis records the new target before clearing only the source pointer that still matches this task. A pointer failure leaves a recoverable state for that recorded target; both `claiming` and target-side `recovery_required` reject a different recovering session. Retrying a recorded pointer operation uses its current generation and does not increment it again.

The ownership `continuity_digest` is the immutable source binding. A recovery stores the acknowledged live projection separately in optional `target_continuity_digest`; legacy records without that field retain their original behavior. `reconcile` requires the consumed target's direct pointer, explicit current digest, generation, package, and unchanged route. It updates only `target_continuity_digest`, never the source binding, task, or phase. There is no command to rewrite the source digest from caller-provided data.

`retire` and `claim` write an intermediate recovery state before changing a session pointer. A failed pointer compare-and-set or verification returns `TASK_TRANSFER_RECOVERY_REQUIRED`; only the recorded direct session may recover that in-progress operation. After a claim reaches stable `claimed`, a different direct session may take over only with an explicit user request and the current expected generation. While holding the ownership lock, Trellis first clears the prior target pointer if it still references this task; an unreadable or unwritable pointer leaves ownership `claimed` and retryable. Trellis then records the new target and increments the generation before setting and verifying the new target pointer. A failed update remains recoverable by the newly recorded target. The previous target can no longer consume or mutate the task. This is an explicit retarget operation, not timeout-based liveness detection. `release` is available to the source before target claim from `quiescing`, `sealed`, or `recovery_required`; it restores and verifies the source pointer, then removes the ownership record. Release does not advance the generation and remains available when the continuity snapshot has gone stale.

Except for `release`, each mutation checks the acknowledged target digest (or the captured source digest for records without one) and original route snapshot. Explicit sealed-source recovery and consumed-target reconciliation may acknowledge a recomputed live digest; the package adapter additionally checks the immutable package/source binding before those operations. Task-record writes and active-task pointer changes serialize through the per-task ownership lock. While ownership is pending, writes are fenced; after `consumed`, only the target session bound to that task may mutate it. A task ID cannot change while its ownership record remains, so task rename is withheld until task completion or cancellation clears that record. A task's phase state remains an independent task concern.

Ownership errors are `TASK_TRANSFER_ABSENT`, `TASK_TRANSFER_ACTIVE`, `TASK_TRANSFER_INVALID_INPUT`, `TASK_TRANSFER_INVALID_TRANSITION`, `TASK_TRANSFER_NOT_AUTHORIZED`, `TASK_TRANSFER_RECOVERY_REQUIRED`, `TASK_TRANSFER_STALE_CONTINUITY`, `TASK_TRANSFER_STALE_GENERATION`, `TASK_TRANSFER_STALE_PACKAGE`, `TASK_TRANSFER_STALE_ROUTE`, `TASK_TRANSFER_TASK_ID_LOCKED`, `TASK_TRANSFER_WITHHELD`, and `TASK_TRANSFER_WRITE_FAILED`.

## Integration boundary

`pennix-session-handoff` may call these commands as an optional adapter. Its package readiness, source lifecycle receipt, target admission, and retention archive remain separate from Trellis phase and task status. The adapter must not write task pointers or Trellis runtime records itself.

## 恢复路径的校验与验收

| 条件 | 原生结果 |
| --- | --- |
| 缺少明确用户授权 | `TASK_TRANSFER_NOT_AUTHORIZED` |
| 包摘要或当前代次不匹配 | `TASK_TRANSFER_STALE_PACKAGE` / `TASK_TRANSFER_STALE_GENERATION` |
| sealed claim 未明确确认已变化的现场摘要 | `TASK_TRANSFER_STALE_CONTINUITY` |
| 原阶段路线、输入或实施授权变化 | `TASK_TRANSFER_STALE_ROUTE` |
| 源会话自接管、其他目标恢复中间态或协调已消费目标 | `TASK_TRANSFER_WITHHELD` |
| 源指针清理或目标指针写入、验证失败 | `TASK_TRANSFER_RECOVERY_REQUIRED`，保留记录目标与当前代次 |

正常路径是源会话 `retire` 后目标 `claim`、`consume`；恢复案例是未绑定目标先以
`status --include-current` 完整核对现场，再显式钉住摘要接管 `sealed`。拒绝案例包括
复用旧摘要、错误代次、第三方恢复 `claiming`，以及改写来源绑定。

`test/scripts/task-workflow.integration.test.ts` 以真实隔离仓库验证上述路径，断言源
指针清理、目标指针、同代次重试、旧目标拒绝、不可变来源及 `task.json` 不变；既有
正常交接与 retarget 回归必须同时通过。`status --include-current` 必须保持读取者无任务绑定。

错误做法是先 `start` 伪造接管现场，或把当前 Git 投影写回来源摘要；正确做法是通过
原生只读投影核对、显式 claim 和 consumed-target reconcile，仅更新目标确认摘要。
