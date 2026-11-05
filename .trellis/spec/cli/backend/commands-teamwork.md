---
name: commands-teamwork
description: "Trellis Teamwork CLI and Core contracts: sessions, configurable profiles, provider processes, and managed batch coordination"
paths:
  - packages/cli/src/commands/teamwork/**
  - packages/core/src/teamwork/**
---

# `trellis teamwork` and Core Teamwork

This spec records the current runtime contracts for `packages/cli/src/commands/teamwork/` and `packages/core/src/teamwork/`. The Core package owns reusable event, projection, storage, and coordination behavior. The CLI owns command parsing, provider adapters, process supervision, and terminal output. Keep the Core public surface in `packages/core/src/teamwork/index.ts` and the package subpath `@pennixrv/trellis-core/teamwork` aligned.

## Command surface

`registerTeamworkCommand` in `packages/cli/src/commands/teamwork/index.ts` registers these commands:

| Command | Responsibility |
| --- | --- |
| `create <name>` | Create a project- or global-scoped Teamwork Session; accepts `chat` or `forum`, task/project metadata, labels, description, context, creator, force, and ephemeral options. |
| `list` | List sessions in the selected scope; supports JSON, all sessions, and all project buckets. |
| `messages <name>` | Read or follow events with sequence, kind, author, target, thread, action, and progress filters; supports raw JSON. |
| `send <name> [text]` | Append a message, optionally targeted to teammates and checked with a delivery mode; body may come from stdin or a file. |
| `wait <name>` | Wait for matching events using author, kind, scope, thread, action, target, progress, all-authors, and timeout filters. |
| `spawn <name>` | Start a provider-backed teammate under a supervisor; supports agent/provider, identity, cwd, model, resume, sandbox, timeout, context, inbox, idle-timeout, and capacity options. |
| `interrupt <name> [text]` | Request replacement instructions for a named teammate using inline, stdin, or file input. |
| `kill <name>` | Stop one teammate, with graceful shutdown by default and an explicit force option. |
| `run [name]` | Create an ephemeral session, run one teammate with a prompt, wait for completion, print the answer, then clean up. |
| `rm <name>` / `prune` | Stop live teammates and remove a session, or preview/select stale sessions for cleanup. `prune` is dry-run unless deletion is explicitly requested. |
| `post <name> <action>` | Add or update a forum thread, including status, labels, assignees, summary, and context. |
| `forum <name>` / `thread <name> <thread>` / `thread rename <name> <old> <new>` | List forum threads, inspect a thread timeline, or rename a thread. |
| `context add|delete|list <name>` | Add, remove, or project session- or thread-level context entries. |
| `title set|clear <name>` | Set or clear the display title without changing the session address. |
| `config` | Resolve the project professional profile, named configuration and mode defaults without launching a process. |
| `plan <draft>` | Validate and freeze schema-2 execution inputs and immutable briefs under the selected task; `--dry-run` writes nothing. |
| `batch <plan> --task <path>` | Run the foreground managed coordinator; `--preflight` checks inputs without provider calls. |

The hidden `__supervisor` command is an internal child-process entry point. `__parse-trace` is a development command for exercising a registered adapter against a recorded trace. Neither is a user workflow surface.

Provider names, launch capabilities, and option validation come from `adapters/`, `teammate-adapters.ts`, `teammate-config.ts`, and `teammate-launch.ts`; do not duplicate their registries here. `run` and `spawn` use the interactive process runtime. Managed batch uses `batch.ts` and `runtime.ts` with the same executable adapter registry.

Product-source and Git write boundaries are teammate role obligations, frozen
in the launch `writePolicy`. They do not require host permission isolation, and
the capability snapshot must not claim technical read-only enforcement. Every
interactive teammate receives these role and result requirements even when
`--agent` is omitted. Host proof still covers actual runtime capabilities such
as waiting, artifact output, transport, and capacity. Native delegation and
implicit-history restrictions remain role obligations; do not publish unproven
memory-isolation or provider-feature claims in the host proof.

## Capacity policy

`.trellis/teamwork.json` schema 2 is the project capacity policy: mode defaults
are members 1/3/3 and concurrency 8/3/3 (general/advisor/committee), with shared
live budget 8 and non-batch reservation 0. Advisor accepts 1–3 assignments;
committee retains 2–3 distinct lenses. Member defaults do not create assignments.
`maxConcurrency` and `capacityPolicy` are resolved runtime output, not additional
policy files. Effective capacity respects the selected mode, explicit request,
shared resources and verified host capability. Existing batch reservations and
interactive workers continue to share admission control.

Schema 1 and missing JSON preserve legacy YAML capacity compatibility. Schema 2
ignores YAML capacity keys with explicit diagnostics; YAML retains idle cleanup.
Environment overrides are diagnosed. Invalid JSON fails closed in batch and
interactive guard resolution. Do not silently fall back from damaged policy.

## Core and CLI boundary

`@pennixrv/trellis-core/teamwork` owns:

- Teamwork Session and event types, parsers, filters, inbox and delivery policy.
- Event append/read/watch APIs, thread and metadata projections, worker state, and coordination projections/transitions.
- Reusable APIs for creating/resolving sessions, messages, contexts, titles, threads, worker lifecycle, interrupts, and coordination facts.

The CLI owns provider invocation and process-specific behavior. Files under `packages/cli/src/commands/teamwork/store/` are CLI filesystem helpers; they do not redefine the public Core event or session schema. Move reusable domain logic into Core before adding parallel CLI implementations.

## Session identity and storage

- A Teamwork Session has a name and `project` or `global` scope. New sessions use `chat` or `forum`; `chat` is timeline-first and `forum` exposes thread-oriented views.
- The default root is `~/.trellis/teamwork`. `TRELLIS_TEAMWORK_ROOT` overrides it. Project-scoped sessions use a sanitized project bucket derived from the current working directory; `TRELLIS_TEAMWORK_PROJECT` carries an explicit bucket to child processes. Global sessions use `_global`.
- A session directory contains `events.jsonl`, its `.seq` sequence sidecar, a session lock, and teammate-specific runtime sidecars as needed. Names used as path segments are restricted to letters, digits, `.`, `_`, and `-`.
- Session lookup without an explicit scope must resolve one unambiguous existing session. If the same name exists in multiple scopes/buckets, the caller must choose a scope or the command reports ambiguity.
- Session deletion is an explicit CLI operation. It stops active teammates before removing the session directory; batch artifact cleanup follows the task's retention rule.

## Event and persistence contract

Every event has `seq`, `ts`, `kind`, and `by`; optional shared fields include `idempotencyKey`, `to`, `origin`, and `meta`. The Core event-kind set is `create`, `join`, `leave`, `message`, `thread`, `context`, `teamwork`, `spawned`, `killed`, `respawned`, `progress`, `done`, `error`, `waiting`, `awake`, `undeliverable`, `interrupt_requested`, `turn_started`, `turn_finished`, `interrupted`, `supervisor_warning`, and `coordination`.

Append and sequence allocation are serialized by the session lock. The `.seq` sidecar is reconciled with the JSONL tail before the next append. A final record without a newline is a torn append and is truncated to the last complete record; complete but unparsable lines remain as evidence of mid-file damage. If a nonempty log has no recoverable sequence, append fails instead of guessing and risking duplicate sequence numbers. Idempotency checks, event validation, and projections belong to Core APIs.

CLI and Core advisory locks preserve empty or malformed holder files and any
liveness result other than a verified `ESRCH`. An empty file may be a live
holder's create-before-write window. Stale recovery serializes through an
exclusive `<lock>.recovery` file and rechecks the holder under that guard, so
concurrent reapers cannot delete a replacement lock. An interrupted recovery
guard remains for explicit inspection; callers time out without stealing it.

`thread` events describe forum thread actions (`opened`, `comment`, `status`, `labels`, `assignees`, `summary`, `processed`, `rename`). `context` events add or delete typed file/raw entries at session or thread scope. `teamwork` events currently carry session-title changes. `coordination` events record batch, assignment, attempt, teammate, lease, command, claim, and receipt facts; the Core reducer validates state transitions and builds the current projection from the event log.

## Teammate process lifecycle

- `spawn` validates the session, teammate name, provider, configuration, and live-teammate capacity before starting the provider process. It records the durable `spawned` event after successful start.
- The supervisor translates provider output and terminal facts into Teamwork events. It owns timeout and optional idle-timeout enforcement, warning emission, child process shutdown, and cleanup of its runtime sidecars.
- Shutdown triggers converge through the supervisor shutdown controller so concurrent signal, timeout, and crash paths emit a consistent terminal result. Graceful shutdown uses a signal/grace period before forced termination; `kill --force` explicitly skips the graceful path.
- Inbox delivery policy is stored with worker state. Targeted delivery modes can reject unknown or terminal workers and record `undeliverable` facts; broadcast behavior follows the selected inbox policy.
- `run` is a one-shot convenience wrapper around session creation, spawn, prompt delivery, wait, result display, and cleanup. It does not replace a managed task plan.

Do not make terminal status depend only on a provider process exiting: adapters may emit terminal events, while the supervisor reconciles missing terminal facts and records exit details. Preserve this ordering when changing adapters or shutdown handling.

### 清理与诊断边界

`kill` 在每次向 supervisor 发信号前核验命令身份；PID 必须为正安全整数。
supervisor 已退出而子进程仍存活时，只有 Linux birth identity 与保存的
`worker-identity` 一致才终止孤儿进程。身份缺失、宿主不支持核验、权限错误或进程
未退出时拒绝清理并保留恢复文件。`rm` 复用该路径，并与 spawn 共用项目锁；
`prune` 保留启动中、存活、不可读或损坏的现场，在锁内复查事件全文摘要与运行态，
只报告实际删除数量。身份无法核验时不能用 `--force` 绕过。

`run` 在 spawn 前读取事件序号，并从该序号等待结果，不能漏掉启动期间的终态。
Core 在写入 `error`、`progress` 事件前脱敏已知凭据格式；CLI 渲染历史诊断时同样
脱敏。消息正文保持协议语义。supervisor 日志不保存启动参数、原始 stdout 或 stderr，
只保存必要的诊断和 stderr 字节数；配置与新建诊断文件使用私有权限。脱敏不保证
识别任意秘密，调用方仍不得将凭据写入消息、结果或诊断。

## Managed batch coordination

`artifact.ts` validates the versioned `TeamworkPlan` and its immutable briefs, and reads/writes queue facts, claims, reports, dispositions, and receipts under the task root. Paths must remain within that root, reject symlink traversal and credential-like content, and bind artifacts to task, batch, assignment, attempt, teammate, plan hash, and source digests.

`coordinator.ts` owns plan-currentness checks, capacity and lease handling, FIFO dispatch, provider-process waits and continuation, cancellation, report acceptance, retries, reconciliation, and the terminal receipt. One foreground `teamwork batch` call owns the full batch; the main agent does not schedule per-assignment waits or retries. A continuation waits on the same provider process under the frozen batch deadline and does not send another prompt or consume an attempt retry. The coordinator keeps other slots moving while a continuation is pending. It does not change Trellis task status, phase acceptance, or delivery readiness. Accepted reports are task-owned evidence for the main task to review through the native task workflow.

The runtime state machine is event-sourced through Core `coordination` events. The batch ends with `ALL_ACCEPTED`, `SETTLED_WITH_FAILURE`, or `RECONCILIATION_REQUIRED`. A valid `blocked` report with evidence final-fails only its assignment and leaves FIFO admission open. Deadline, stale-plan, or cancellation closure marks undispatched work `FINAL_FAILED`, then drains active attempts; uncertain dispatch, artifact completeness, or process exit requires reconciliation and retains capacity. Missing reports and rejected/incomplete report content may retry within the declared attempt budget; unreadable or truncated report artifacts require reconciliation. Same-process wait continuations do not consume that budget.

Before returning a terminal receipt, the CLI verifies the frozen plan, exact assignment set and dispositions, terminal attempt/teammate facts, absence of capacity leases and projection issues, and a unique matching receipt event. Recovery may recreate a missing receipt only from those consistent durable facts. A conflicting receipt or projection remains in reconciliation and cannot release an unresolved reservation.

`profiles.ts` reads schema-2 `.trellis/agents/teammate-profiles.json`; each of six
professional profiles owns a role-card path and 2–3 named execution candidates.
`coordination.ts` reads `.trellis/teamwork.json` separately. Selection is explicit;
there is no silent provider/model fallback or context-window tuning. Common and
professional instructions, evidence, effective execution values and digests are
frozen by `plan.ts`. Execution does not reread mutable project role files.
Claims use schema 2 and configuration identity. New launches freeze
`reportVersion: 2`; their content reports require answer, evidence, limitations,
unresolved items and deviations. Historical launches without this version keep
their schema-1 report contract. Never synthesize a new valid answer from a
legacy report.

Agent callers use `run --json`, `batch --json`, or
`wait --json --from <one-worker>`. All return one `trellis_result` envelope
separating execution facts, content validation, model status and disposition.
Semantic validation remains `not_run` until the main agent reviews it through
the task workflow. Persistent results bind replies to `inputSeq`/`turnId`;
batch results expose verified content, artifact paths and SHA-256. Cleanup
must not invalidate returned content. Human run text and event waits remain
compatible views; diagnostics must not pollute machine stdout.

Initialization instructions contain role rules and the mode result contract.
Reference data travels with task input. Manifest `delivery` is `inline`
(default), `required` (read fully before work), or `on-demand`; references
carry paths, reasons and hashes. New batch dispatch and completion recheck
frozen reference bytes without claiming proof that the model read them.
ACP sends plain role/task blocks, retaining rules after a successful turn and
reestablishing them after recovery. ACP user blocks do not gain system priority.
Capability `evidence: adapter-contract` is static, not a live backend probe.

Tool permissions are automatically allowed. Codex defaults to no sandbox
(`danger-full-access`, `approvalPolicy: never`); explicit user overrides remain
available. Tool availability, AGENTS, Skills and ambient memory depend on the
host. Prompt obligations do not prove technical read-only or memory isolation.

The constructor validates before publication, including prepared brief size,
secret checks, committee equivalence, symlink ancestors, current task revisions
and output containment. Preview performs the same validation without writes.
`batch --preflight` is not an account or generation probe. Codex negotiates the
full paginated model catalog and reasoning support; ACP applies advertised
configuration options before accepting a prompt. DSH uses `--profile acp` and
advertised `session/resume`; Copilot uses `session/load`. ACP instructions and
task data use distinct user-content blocks, without claiming system priority.

Batch capacity is reserved durably under the project guard lock, counted by
interactive spawn too, and released after a durable terminal receipt. A dead
coordinator or uncertain cancellation does not release it. Session rm/prune
preserve unresolved reservations. Runtime signal shutdown confirms child exit;
unconfirmed exit yields reconciliation. Codex and ACP interrupt replacements
wait for the old turn's terminal response. Recovery may read an expired plan to
return an existing receipt, but an expired new batch cannot dispatch.

## Change and verification requirements

批次容量按实际 assignment 数量收敛，项目锁下同时计入其他批次预留和非批次成员，避免双重计数。`max_live_teammates: 0` 只关闭共享上限。冻结后的启动策略可以收紧，不能通过配置或环境变量放宽；启动后策略变化停止后续派发，已运行进程仍须确认退出。

所有 attempt 的报告、工作日志和有界 stderr 诊断保留到显式 `cleanup-artifacts`。该命令先验证终态回执、无未释放预留及安全路径，预览文件指纹，只有匹配 `--confirm` 摘要才删除。结果 `attempts` 包含全部尝试，`reports` 保持最终报告兼容视图。

`reconcile` 以持久化进程终止事实或可核验进程出生身份为依据，仅在资源已结束时收敛；未知或仍存活的进程保留租约。`retry` 只从已终结失败批次选取失败 assignment，生成带原计划关联的新冻结计划，复用原执行和输入合同，不重做已接受成员。

Codex 前台等待投影由 CLI 写入，在受支持的 PreToolUse 工具面阻止无关动作，允许原等待续接及有界原生恢复。Skill 要求静默续接同一宿主句柄。该组合不承诺阻止普通模型消息、未接入 Hook 的工具或宿主唤醒，也不把主代理变成 FIFO 调度者。

- Update Core exports, CLI consumers, templates, tests, and this spec together when changing a public Teamwork contract. Keep `packages/cli/src/templates/trellis/scripts/` in parity with `.trellis/scripts/` where the same runtime script is shipped in both locations.
- Cover event validation and sequence recovery, scope resolution and path safety, process start/terminal/shutdown behavior, command registration, and batch artifact/state transitions at the layer that owns each behavior.
- Before changing process or filesystem behavior, read `filesystem-safety.md`, `trellis-core-sdk.md`, and the relevant unit-test conventions. Run focused tests, then the package lint, typecheck, and test suites required by the change.

## Source of truth

- Core public surface: `packages/core/src/teamwork/index.ts`
- Event schema and persistence: `packages/core/src/teamwork/internal/store/`
- CLI registration and runtime: `packages/cli/src/commands/teamwork/`
- Batch artifacts and coordinator: `artifact.ts`, `coordinator.ts`, and their CLI tests
- Dogfood Trellis scripts: `.trellis/scripts/`; shipped copies: `packages/cli/src/templates/trellis/scripts/`
