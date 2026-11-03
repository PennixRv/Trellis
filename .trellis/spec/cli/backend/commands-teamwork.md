---
name: commands-teamwork
description: "Trellis Teamwork CLI and Core contracts: Teamwork Sessions, event storage, teammate processes, forums, and the gated batch coordinator"
paths:
  - packages/cli/src/commands/teamwork/**
  - packages/core/src/teamwork/**
---

# `trellis teamwork` and Core Teamwork

This spec records the current runtime contracts for `packages/cli/src/commands/teamwork/` and `packages/core/src/teamwork/`. The Core package owns reusable event, projection, storage, and coordination behavior. The CLI owns command parsing, provider adapters, process supervision, and terminal output. Keep the Core public surface in `packages/core/src/teamwork/index.ts` and the package subpath `@mindfoldhq/trellis-core/teamwork` aligned.

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
| `batch <plan>` | Reserved for the managed coordinator. The current CLI rejects dispatch before writing coordination state because no verified teammate host adapter is installed. |

The hidden `__supervisor` command is an internal child-process entry point. `__parse-trace` is a development command for exercising a registered adapter against a recorded trace. Neither is a user workflow surface.

Provider names, launch capabilities, and option validation come from `adapters/`, `teammate-adapters.ts`, `teammate-config.ts`, and `teammate-launch.ts`; do not duplicate their registries here. `run` and `spawn` use the interactive process runtime. The managed batch path has a separate host-capability contract and must remain closed until a verified host adapter is integrated.

Product-source and Git write boundaries are teammate role obligations, frozen
in the launch `writePolicy`. They do not require host permission isolation, and
the capability snapshot must not claim technical read-only enforcement. Every
interactive teammate receives these role and result requirements even when
`--agent` is omitted. Host proof still covers actual runtime capabilities such
as waiting, artifact output, context isolation, transport, and capacity.

## Core and CLI boundary

`@mindfoldhq/trellis-core/teamwork` owns:

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

`thread` events describe forum thread actions (`opened`, `comment`, `status`, `labels`, `assignees`, `summary`, `processed`, `rename`). `context` events add or delete typed file/raw entries at session or thread scope. `teamwork` events currently carry session-title changes. `coordination` events record batch, assignment, attempt, teammate, lease, command, claim, and receipt facts; the Core reducer validates state transitions and builds the current projection from the event log.

## Teammate process lifecycle

- `spawn` validates the session, teammate name, provider, configuration, and live-teammate capacity before starting the provider process. It records the durable `spawned` event after successful start.
- The supervisor translates provider output and terminal facts into Teamwork events. It owns timeout and optional idle-timeout enforcement, warning emission, child process shutdown, and cleanup of its runtime sidecars.
- Shutdown triggers converge through the supervisor shutdown controller so concurrent signal, timeout, and crash paths emit a consistent terminal result. Graceful shutdown uses a signal/grace period before forced termination; `kill --force` explicitly skips the graceful path.
- Inbox delivery policy is stored with worker state. Targeted delivery modes can reject unknown or terminal workers and record `undeliverable` facts; broadcast behavior follows the selected inbox policy.
- `run` is a one-shot convenience wrapper around session creation, spawn, prompt delivery, wait, result display, and cleanup. It does not replace a managed task plan.

Do not make terminal status depend only on a provider process exiting: adapters may emit terminal events, while the supervisor reconciles missing terminal facts and records exit details. Preserve this ordering when changing adapters or shutdown handling.

## Managed batch coordination

`artifact.ts` validates the versioned `TeamworkPlan` and its immutable briefs, and reads/writes queue facts, claims, reports, dispositions, and receipts under the task root. Paths must remain within that root, reject symlink traversal and credential-like content, and bind artifacts to task, batch, assignment, attempt, teammate, plan hash, and source digests.

`coordinator.ts` owns plan-currentness checks, capacity and lease handling, dispatch, wait/continue/cancel outcomes, report acceptance, retries, reconciliation, and the terminal receipt. Its inputs include a host capability contract and runtime; it does not change Trellis task status, phase acceptance, or delivery readiness. Accepted reports are task-owned evidence for the main task to review through the native task workflow.

The runtime state machine is event-sourced through Core `coordination` events. The batch ends with `ALL_ACCEPTED`, `SETTLED_WITH_FAILURE`, or `RECONCILIATION_REQUIRED`. Uncertain dispatch or cancellation is reconciled before work is duplicated. Retry is limited to an assignment's declared budget and confirmed failure; a timeout may continue the same attempt when the host confirms that continuation is valid.

Although the coordinator and artifact contracts exist, `trellis teamwork batch <plan>` currently refuses dispatch before writing coordination state. Do not describe or test the command as an active dispatcher until a verified host adapter is installed and the gate is deliberately connected to the coordinator.

## Change and verification requirements

- Update Core exports, CLI consumers, templates, tests, and this spec together when changing a public Teamwork contract. Keep `packages/cli/src/templates/trellis/scripts/` in parity with `.trellis/scripts/` where the same runtime script is shipped in both locations.
- Cover event validation and sequence recovery, scope resolution and path safety, process start/terminal/shutdown behavior, command registration, and batch artifact/state transitions at the layer that owns each behavior.
- Before changing process or filesystem behavior, read `filesystem-safety.md`, `trellis-core-sdk.md`, and the relevant unit-test conventions. Run focused tests, then the package lint, typecheck, and test suites required by the change.

## Source of truth

- Core public surface: `packages/core/src/teamwork/index.ts`
- Event schema and persistence: `packages/core/src/teamwork/internal/store/`
- CLI registration and runtime: `packages/cli/src/commands/teamwork/`
- Batch artifacts and coordinator: `artifact.ts`, `coordinator.ts`, and their CLI tests
- Dogfood Trellis scripts: `.trellis/scripts/`; shipped copies: `packages/cli/src/templates/trellis/scripts/`
