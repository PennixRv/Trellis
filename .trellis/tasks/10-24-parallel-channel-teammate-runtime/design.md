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
| ------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
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
The new sections are `teamwork.teammate` and `teamwork.teammate_guard`. They
use the new Teamwork schema; no old fork `channel.teammate` configuration is
read or migrated.
Only the new schema is read; there is no old fork configuration fallback or
dual-read path. Unsupported values, an unbounded limit, or a non-positive guard
fail closed; there is no implicit global retry default.

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

## Independent evaluation patterns

An advisor is one frozen work unit that returns a second opinion on a specified
design, research question, or completed change. A committee is two independent
work units in one frozen batch, each given the same question, source/context
snapshot, and acceptance target. The two executions have separate sessions and
reports; neither receives the other's report or a peer message. The main agent
reads and compares available reports only after the entire batch returns a
business terminal receipt. If either member reaches final failure, the result
is incomplete and must not be described as committee consensus.

These are task shapes, not additional roles or state machines. Both use the
generic `teammate` role and existing work/attempt contract. The brief `lens`
specifies reviewer, security, correctness, architecture, or other expertise;
execution `profile` selects provider/model/reasoning separately. Distinct
providers are optional. Paseo's member-to-member argument relay and repeated
convergence are excluded because they create dynamic work after plan freeze.

The new `counter_of` work relation remains separate from committee mode: its evidence-
disjoint counter contract must not be reused for committee reports, which may
cite the same authoritative source. Add an optional `evaluation_group` to
BatchWorkUnit containing a safe group ID and `kind: committee`.
`validateBatchPlan` must require exactly two
distinct work IDs per group. Compare the full normalized work contract:
exclude work identity, provider/profile/model, `lens`, brief path, and brief
digest, then inline the referenced brief JSON after excluding its work
identity, provider/profile/model, and `lens`. The normalized contracts must be
identical and the two lens values must differ. This also constrains retry
budget and future shared fields without a partial allowlist. Provider/profile/model
may differ but need not. Freeze the relation into the plan hash; reject
incomplete, oversized, duplicate, cross-batch, or mismatched groups before
dispatch.

No group FSM is needed. Once the existing batch returns a business terminal
receipt, the CLI derives each group's `COMPLETE` or `INCOMPLETE` summary from
its members' existing `ACCEPTED`/`FINAL_FAILED` outcomes. `UNKNOWN` remains on
the existing reconciliation path and cannot produce a group terminal result.
Retries remain per work under the frozen budget; a failed member never causes
dynamic addition of a third member. The main agent reads or compares reports
only after the whole batch terminal barrier.

The public entry is one `trellis-teamwork` bundled Skill and the `trellis
teamwork` CLI root. Register the entire beta.4 Channel command tree under
Teamwork, preserving each subcommand contract without an old root alias. The
Skill absorbs the useful old Channel references and rewrites them for the
frozen-plan coordinator; it covers command routing, forum/thread, teammate
lifecycle, batch state machine, independent evaluation, and diagnostics through
on-demand references. No old Skill/CLI alias, old configuration/artifact/event
reader, or migration is provided. Core Channel API/event/store names remain
those of beta.4. The injected `.trellis/agents/teammate.md` remains the participant
behavior contract; no separate teammate/advisor/committee Skill or role card is
needed. The Skill uses the existing bundle/template mechanism and defines no
Marketplace workflow or runtime state. Rename the old `references/workers.md`
content to a correctly named teammate-process reference and update every
in-repository link; remove or rewrite manual parallel recipes that bypass the
coordinator.

The approved `counter_of` contract is a separate directed evidence pair, not
a committee. Map it to two distinct work IDs in one
frozen batch, with `counter_of` pointing to the primary work ID. Freeze their
objective, source/context, acceptance contract, and per-work retry budget;
require distinct lens and execution identity, and do not expose the primary
report to the counter. Before accepting the pair, validate that the reports'
`(evidence.id, evidence.locator)` identities do not overlap. This preserves the
old validator's identity rule; it does not prove semantic independence. An
overlap rejects the counter report only and consumes only its frozen full-retry
budget. A final primary failure prevents pair completion. The relation belongs
in the batch plan hash; reject orphaned, multiple, cross-batch, or inconsistent
relations. Validate the relation before dispatch without adding a new state
machine or batch outcome.

## Adapter contract and host boundary

The provider-neutral contract records the required launch, prompt/context,
continuation, interrupt, cancel, terminal, and failure capabilities for Codex
app-server, DSH ACP, Copilot ACP, and Claude Code CLI. This implementation
registers those contracts, builds a digest-bound launch specification, and
keeps the batch command fail-closed when a host proof is absent. It does not
execute the external provider protocols or implement Paseo/Provider host gates;
the PRD places those integrations outside this task.

Unsupported capability or option, prompt/context digest mismatch, missing role
file, or lifecycle ambiguity fails closed before dispatch. The `teamwork batch`
entry point must not bypass the gate. Deterministic tests may inject a verified
runtime without claiming that any real host is ready.

The frozen brief is the complete context boundary. A host must prove that
implicit personal, session, and cross-project memory is unavailable to the
Teammate; the proof is part of the digest-bound capability snapshot. The role
card repeats this as behavior guidance, but the host gate is authoritative. A
host that cannot isolate implicit memory remains unavailable and fails closed.

## Cutover and regression verification

The old Pennix fork's command, Skill, configuration, event, identity, and
artifact formats are not runtime inputs and receive no alias, dual-read,
fallback, or migration path. The new CLI root is `trellis teamwork`; one
`trellis-teamwork` Skill absorbs and rewrites the useful old Channel guidance.
Core Channel API/event/store names remain the beta.4 architectural primitives.
The coordinator is
opt-in and uses those existing Channel event, barrier, and wait mechanisms. It
does not turn task status into batch status or publish another workflow.

Regression tests preserve beta.4 ordinary task and Core Channel behavior under
the renamed CLI surface. This is verification against the selected upstream
baseline, not support for old Pennix fork inputs.

## Native task progress and completion

`trellis task progress [--json]` is a read-only summary of direct, non-archived
task records under `.trellis/tasks/`. It counts `planning`, `in_progress`, and
`completed`; malformed records or unknown statuses set `partial` and do not
create or infer a state. Native task commands remain the only status writers.
Implementation and check templates continue to require timely task updates,
design comparison, risk-proportional tests and review, fixes with re-verification,
and execution checkpoints. This task observability does not add a batch state
or alter the native task lifecycle.

Tests are layered: Core event/reducer/idempotency tests; CLI coordinator,
guard, adapter, supervisor, artifact, and receipt tests; template/init/update
fixtures; and focused normal-path regression tests. Static review compares
every retained old-fork capability to this owner map without implementing its
old runtime formats. Real Paseo/Provider/CLI
execution and strict-batch enablement remain deferred.
