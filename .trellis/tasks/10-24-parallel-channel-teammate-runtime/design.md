# Design

## Source and ownership boundary

The only source baseline is Trellis beta.4
`be9e19b269c25cb2787489eb81062bf96619442c`. The implementation branch is the
existing `v0.7.1`. Core owns durable Channel events, event validation, replay,
idempotency, and typed projections. CLI owns command parsing, coordinator
orchestration, provider adapters, supervisor process control, artifact
validation, and user-facing receipts. Templates own generated role/config/
script/Skill assets. The root repository owns cross-repository evidence; the
Marketplace checkout owns Marketplace source changes on its existing `main`.

The implementation reuses beta.4 extension points. A new API is added only
when an existing Core or CLI contract cannot represent a required frozen fact.
A new fact belongs in the existing Channel event log or task-owned artifact
path; no parallel runtime database or hidden in-memory registry is authoritative.

## Durable facts and artifacts

The coordinator receives one immutable batch plan containing `task_id`,
`batch_id`, `plan_hash`, ordered work units, role/profile/provider selections,
acceptance contracts, per-work non-negative `max_retries`, retry matrix,
requested capacity, and deadline. It validates and stores the plan identity in
the existing Channel namespace before any dispatch side effect.

Every command and external side effect has a durable create-once claim or
command identity. The program confirms the matching Channel event sequence and
terminal projection before interpreting the outcome. Unknown delivery or
consumption is `reconciliation_required`; it is never silently replayed as a
new spawn or retry.

| Artifact | Writer | Rule |
| --- | --- | --- |
| `brief.json` | main agent | immutable work identity, required summary, role/provider/profile/model, scope/lens, source/context digests, deadline, acceptance |
| `queue.json` | program | create-once FIFO position bound to the plan and brief digests |
| `claim.json` | program | create-once attempt identity and frozen execution/capability snapshot |
| `worklog.md` | teammate | append-only progress and checkpoint evidence for one attempt |
| `report.json` | teammate | one pending-review submission at the canonical attempt path |
| `disposition.json` | program | write-once acceptance or final failure after terminal/report validation |

All records live below `.trellis/tasks/<task>/teammates/<batch>/<work>/`.
The brief is `brief.json`, the queue fact is `queue.json`, and attempt records
are under `attempts/<attempt-id>/`. The main agent freezes the brief and plan
before submission; the program creates queue, claim, and disposition records.

Artifact validation checks task/work/attempt/teammate identity, source
snapshot, terminal association, protected target, safe path, secret and
symlink rules, and report/disposition ordering. The exact path remains under
the active task's canonical artifact directory.

## State machines

The batch coordinator owns `PREPARED -> VALIDATING_PLAN -> RUNNING ->
SETTLING -> ALL_ACCEPTED | SETTLED_WITH_FAILURE`. It may enter `SUSPENDED`,
`CANCEL_PENDING`, or `RECONCILIATION_REQUIRED` for control conditions. A
control receipt is not a business result. Only the coordinator may dispatch,
refill, request continuation, create a complete retry, validate, record
disposition, cancel, or reconcile.

Each work unit owns `QUEUED -> ASSIGNED -> EXECUTING -> REPORT_PENDING ->
VALIDATING -> ACCEPTED | FINAL_FAILED`. A timeout-yield moves the current
attempt to `WAITING_FOR_MAIN_COMMAND` and may return to `EXECUTING` through a
continuation command. Confirmed execution failure or rejection by the frozen
acceptance contract creates a new attempt only when the work unit's retry budget
permits. This is coordinator adjudication, not a separate reviewer state. Any
review performed outside that adjudication does not alter the coordinator's
execution retry count.

The teammate execution protocol owns `ASSIGNED -> RUNNING -> REPORT_SUBMITTED`
or `FAILED`. A live timeout moves to `TIMEOUT_YIELDED -> WAITING_FOR_MAIN_COMMAND`;
only a program continuation command returns it to `RUNNING`. Stop requests
remain non-terminal until the Channel terminal projection confirms completion.
The protocol never creates another teammate and never performs self-retry.

## Capacity, FIFO, and cleanup

At submission, the coordinator resolves and freezes:

```text
C = min(
  batch_requested_or_default,
  teammate.max_concurrency,
  teammate_guard.max_live_teammates - non_batch_reserved,
  verified_host_cap,
)
```

`C` must be positive. An explicit request above the verified limit is rejected.
Later resource contention waits for an atomic guard acquisition and cannot
over-dispatch. Each logical slot owns one unresolved work unit and at most one
active Teammate execution. A continuation stays in its slot. A complete
retry gets a new attempt/teammate identity but reuses the same slot. Only
`ACCEPTED` or `FINAL_FAILED` releases a slot; the coordinator then claims the
oldest unstarted FIFO unit immediately.

The coordinator records a protected activity/lease fact for an execution with
unfinished work or a wait for a main-agent command. Idle cleanup must not kill
such an execution. A hard timeout may terminate a process only under the
frozen policy and is subsequently reconciled as a terminal process fact.

## Configuration and identity

Project configuration is read through the existing Trellis config resolver.
The new sections are `channel.teammate` and `channel.teammate_guard`.
Legacy configuration is read-only compatibility input. Conflicts, an old
unbounded value, a non-positive guard, or unsupported overrides fail closed;
there is no implicit global retry default.

The generated role card is provider-neutral and is loaded by the existing
agent-loader. A resolved execution tuple is:

```text
role_id + provider_id + optional profile/model/options
```

The provider adapter owns the CLI/ACP command, environment, tool allowlist,
native-delegation suppression, and lifecycle translation. The attempt snapshot
records the resolved values and capability digest. The role card defines
behavior only; it cannot grant permissions.

The role is limited to investigation, research, review, verification, and
evidence/report writing. Runner and host capabilities enforce read-only
product source, protected config, and Git state, with writes limited to the
current attempt artifact and necessary analysis output. No Git worktree is
created.

## Adapter contract and host boundary

The provider-neutral contract records the required launch, prompt/context,
continuation, interrupt, cancel, terminal, and failure capabilities for Codex
app-server, DSH ACP, Copilot ACP, and Claude Code CLI. This implementation
registers those contracts, builds a digest-bound launch specification, and
keeps the batch command fail-closed when a host proof is absent. It does not
execute the external provider protocols or implement Paseo/Provider host gates;
the PRD places those integrations outside this task.

Unsupported capability or option, prompt/context digest mismatch, missing role
file, or lifecycle ambiguity fails closed before dispatch. The `channel batch`
entry point must not bypass the gate. Deterministic tests may inject a verified
runtime without claiming that any real host is ready.

The frozen brief is the complete context boundary. A host must prove that
implicit personal, session, and cross-project memory is unavailable to the
Teammate; the proof is part of the digest-bound capability snapshot. The role
card repeats this as behavior guidance, but the host gate is authoritative. A
host that cannot isolate implicit memory remains unavailable and fails closed.

## Compatibility and verification

The ordinary single-agent task path, native workflow, existing Channel
commands, and existing event records remain readable. The coordinator is
opt-in and uses existing Channel event, barrier, and wait mechanisms. It does
not turn task status into batch status and does not publish a second workflow.

Tests are layered: Core event/reducer/idempotency tests; CLI coordinator,
guard, adapter, supervisor, artifact, and receipt tests; template/init/update
fixtures; and focused normal-path regression tests. Static review compares
every retained old-fork path to this owner map. Real Paseo/Provider/CLI
execution and strict-batch enablement remain deferred.
