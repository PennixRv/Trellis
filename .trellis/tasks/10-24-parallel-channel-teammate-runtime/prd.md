# Trellis Channel Teammate Runtime

## Goal

Implement the first parallel coordination slice on the beta.4 source baseline,
on the existing `v0.7.1` branch, while keeping Trellis task lifecycle and the
native Channel lifecycle separate. The implementation must make the approved
batch state machine executable by the Trellis program, so the main agent only
submits a frozen plan and receives a bounded receipt.

## Requirements

- Preserve the beta.4 Core/CLI package boundary, Core public exports, event-log
  durability, idempotency, barrier/replay behavior, and one-shot execution
  semantics under the new `teamwork run` command.
- Use `teammate` as the new public role and artifact vocabulary. Do not read or
  migrate old Pennix fork event, configuration, identity, or artifact formats;
  do not create a second public lifecycle vocabulary.
- Implement the three approved business state machines: batch coordinator;
  work/attempt; and teammate execution protocol. Keep the Agent-to-program
  handoff as a command/receipt protocol rather than a fourth lifecycle.
- After plan submission, program code owns dispatch, event routing, validation,
  bounded retry, recovery, cancellation, reconciliation, and settlement. The
  main agent does not receive individual work reports during the batch.
- Compute effective capacity from the frozen batch request, project config,
  shared guard, non-batch reservation, and verified host cap. Reject explicit
  over-limit plans; never silently shrink a plan. A logical slot has at most
  one active teammate and is refilled FIFO only after accepted or final failure.
- Distinguish timeout continuation from complete retry. Continuation resumes
  the same session and attempt. Confirmed execution failure or acceptance
  rejection creates a new attempt and teammate identity only within the frozen
  per-work budget. Teammates never retry themselves.
- Keep unfinished work and waits for a main-agent command protected from idle
  cleanup. A process hard timeout is a terminal process action, not a
  timeout-yield.
- Add task-owned artifact validation for immutable brief, claim, queue,
  worklog, report, evidence, and disposition records. Reports remain separate
  from coordinator acceptance and are not exposed as business results before
  batch settlement. Every work brief has a bounded required `summary` that is
  frozen identically in the plan and brief digest.
- Provide one provider-neutral role/profile/config resolution path and adapters
  for Codex app-server, DSH ACP, Copilot ACP, and Claude Code CLI. Each adapter
  must disable native delegation, enforce the read-focused teammate boundary,
  and fail closed when its tool surface or lifecycle contract cannot be
  proved.
- Materialize the common role card and configuration through Trellis template,
  init, update, and agent-loader paths. Role text is not a permission boundary;
  runner/host capabilities enforce protected-source and Git read-only access
  plus attempt-artifact write access.
- Support advisor and two-perspective committee patterns as fixed-batch task
  shapes. They reuse the generic teammate role and existing batch/work/attempt
  state machines; participants do not read or message one another, and the
  main agent synthesizes reports only after the batch reaches a business
  terminal receipt. Encode the committee pair in the frozen plan and validate
  its shared brief contract in the CLI; derive its terminal result from member
  outcomes without adding an FSM.
- Preserve the old fork's `counter_of` evidence-pair capability under the new
  contract, separately from committee mode. Map primary/counter to distinct
  work IDs in one frozen batch; the counter points to the primary work ID, and
  the CLI checks disjoint evidence identities during acceptance. Overlap rejects
  only the counter report and uses that work's bounded retry budget; the primary
  report is never injected into the counter context.
- Keep reviewer, advisor, committee, security, correctness, and architecture
  as task lenses or Skill procedures unless they require distinct permissions,
  tools, lifecycle, or artifact contracts. Keep execution profiles separate
  from roles.
- Replace the bundled `trellis-channel` Skill with one `trellis-teamwork`
  entry that absorbs and rewrites its useful references for the new contract.
  Register the complete beta.4 Channel command tree under the new public
  `trellis teamwork` root and use a new `teamwork.teammate` runtime
  configuration namespace. Retain Core Channel API/event/store names. Add no
  old-name alias, old-format reader, or Marketplace workflow.
- Keep the normal single-agent task path and native workflow unchanged. Preserve
  beta.4 Core Channel behavior through the new CLI surface; batch behavior stays
  opt-in and adds no task lifecycle state or Marketplace workflow.
- Restore the generic read-only `trellis task progress [--json]` summary for
  active task records. Count only `planning`, `in_progress`, and `completed`,
  exclude archived tasks, and report malformed or unknown records as partial
  without inventing a lifecycle state. Native task commands remain the only
  task-state writers; task progress is separate from the batch state machines.
- Provide deterministic unit, integration, contract, and fixture tests for
  source/schema/caller/state-machine contracts. Real Paseo, Provider, and CLI
  host execution is out of scope; without the host gate, Agent-facing batch
  entry points fail closed before dispatch.

## Non-goals

- Do not modify the root repository gitlink, docs-site, or root release files.
- Do not modify Marketplace workflow source in this task; its existing `main`
  checkout has a separate owner record.
- Do not implement Paseo/Provider host gates or enable strict batch mode on a
  real host.
- Do not add dynamic replanning, runtime work splitting/merging, runtime
  provider/model switching, an unbounded retry policy, a scheduler outside the
  Channel runtime, or a second event/artifact ledger.
- Do not copy Paseo's peer-to-peer committee convergence loop, add dedicated
  advisor/reviewer/committee role cards, or introduce a new committee FSM.
  Committee membership validation is a frozen-plan contract, not a Skill-only
  convention.
- Do not create additional branches or Git worktrees.

## Acceptance Criteria

- [x] `v0.7.1` remains based on beta.4 and every changed source, test, template,
      config, and generated-asset path has an owner and deterministic check.
- [x] Core durable facts and CLI projections implement the three state
      machines, capacity formula, FIFO refill, bounded retry matrix, protected
      lease, idempotent command/claim behavior, and reconciliation rules.
- [x] Normal Channel and task behavior has regression coverage and unchanged
      one-shot semantics.
- [x] Role/profile/config resolution and all four adapter contracts are covered
      by fixtures; unsupported or unverifiable capabilities, including isolation
      from implicit host memory, fail closed. Only context frozen in the brief
      may be injected into a Teammate.
- [x] Artifact placement and validation reject identity, source, terminal,
      protected-target, secret, path, status, and missing/mismatched brief
      summary inconsistencies.
- [x] Template registration, init/update behavior, generated role/config assets,
      and the bundled Teamwork Skill remain sourced from the Trellis template
      owner. Reports for advisor/committee patterns remain hidden until the
      existing batch terminal receipt; no new FSM or peer exchange is added.
- [x] The public `trellis teamwork` command has no old-name alias; the new
      `teamwork.teammate` config, Skill, and artifact paths read only their new
      formats. Core Channel behavior remains covered against beta.4.
- [x] Encode `counter_of` as two distinct work IDs in one frozen batch with a
      directed primary relation, identical shared contract and retry budget,
      distinct lens/execution identity, and no primary-report disclosure.
      Validate evidence identity disjointness and retry only the rejected
      counter work within its budget; do not claim semantic independence or add
      a state machine.
- [x] `trellis task progress` reports the three native task statuses without
      mutating task records; archive entries are excluded, and malformed or
      unknown records set `partial: true` in JSON output.
- [x] Component lint, typecheck, Python checks, focused tests, and static review
      pass. The acceptance record lists deferred host-gate evidence and does
      not claim production runtime readiness.
