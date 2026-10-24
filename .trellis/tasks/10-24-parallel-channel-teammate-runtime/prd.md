# Trellis Channel Teammate Runtime

## Goal

Implement the first parallel coordination slice on the beta.4 source baseline,
on the existing `v0.7.1` branch, while keeping Trellis task lifecycle and the
native Channel lifecycle separate. The implementation must make the approved
batch state machine executable by the Trellis program, so the main agent only
submits a frozen plan and receives a bounded receipt.

## Requirements

- Preserve the beta.4 Core/CLI package boundary, public exports, event-log
  durability, idempotency, barrier/replay behavior, and `channel run` one-shot
  semantics.
- Use `teammate` as the new public role and artifact vocabulary. Keep existing
  event-log records and internal compatibility fields readable where migration
  requires it; do not create a second public lifecycle vocabulary.
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
- Keep the normal single-agent task path, native workflow, and one-shot Channel
  path unchanged. Batch behavior is opt-in and must not add a task lifecycle
  state or a Marketplace workflow.
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
- Do not create additional branches or Git worktrees.

## Acceptance Criteria

- [ ] `v0.7.1` remains based on beta.4 and every changed source, test, template,
      config, and generated-asset path has an owner and deterministic check.
- [ ] Core durable facts and CLI projections implement the three state
      machines, capacity formula, FIFO refill, bounded retry matrix, protected
      lease, idempotent command/claim behavior, and reconciliation rules.
- [ ] Normal Channel and task behavior has regression coverage and unchanged
      one-shot semantics.
- [ ] Role/profile/config resolution and all four adapter contracts are covered
      by fixtures; unsupported or unverifiable capabilities, including isolation
      from implicit host memory, fail closed. Only context frozen in the brief
      may be injected into a Teammate.
- [ ] Artifact placement and validation reject identity, source, terminal,
      protected-target, secret, path, status, and missing/mismatched brief
      summary inconsistencies.
- [ ] Template registration, init/update behavior, generated role/config assets,
      and the bundled Channel Skill remain sourced from the Trellis template
      owner.
- [ ] Component lint, typecheck, Python checks, focused tests, and static review
      pass. The acceptance record lists deferred host-gate evidence and does
      not claim production runtime readiness.
