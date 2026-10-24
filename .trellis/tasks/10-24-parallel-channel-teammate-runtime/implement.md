# Implementation Plan

This plan belongs to root coordination task `trellis-fork-rebuild-parallelism`.
It runs only on the existing Trellis `v0.7.1` branch, with no additional
branch or worktree. This approved plan is in execution; the component task
remains `in_progress` until the static acceptance gates are satisfied.

<!-- trellis-implementation-plan:v1 -->
```json
{
  "schema_version": 1,
  "steps": [
    {
      "id": "baseline-and-owner-ledger",
      "depends_on": [],
      "target": "beta.4 Core/CLI Channel source, tests, templates, and Pennix beta.54 comparison",
      "action": "Freeze the beta.4 source and package boundary. Compare every relevant beta.4-to-Pennix change in Core channel APIs/reducers/store, CLI channel commands/supervisor/adapters, template registration/config/role assets, artifact scripts, Skill sources, and tests. Record caller, owner, compatibility, retained behavior, migration, removal, or deferral. Run unchanged beta.4 focused baseline tests before editing.",
      "deliverables": "Source-owner ledger, baseline test receipt, and exact changed-path list.",
      "verification": "git diff, focused Core/CLI test commands, package-boundary inspection, and root checkpoint.",
      "risks": "A fork change may already be covered by beta.4 or may depend on a template/test consumer outside the obvious path.",
      "rollback": "No source change; record unresolved ownership and keep the component task in planning."
    },
    {
      "id": "core-channel-facts-and-projections",
      "depends_on": ["baseline-and-owner-ledger"],
      "target": "packages/core/src/channel and packages/core/test/channel",
      "action": "Preserve beta.4 event-log append, lock, sequence, barrier, replay, and idempotency contracts. Add only typed durable facts and projections needed by the coordinator: plan/claim/command/receipt correlation, session/terminal association, protected activity, and reconciliation metadata. Reuse the existing Channel namespace and public exports; do not add a second ledger or task lifecycle state. Make duplicate, late, aborted, and uncertain events deterministic.",
      "deliverables": "Core event types, reducer/projection changes, public API additions where required, and focused tests.",
      "verification": "Core lint, typecheck, and channel tests covering append ordering, idempotency replay, barrier replay, terminal separation, protected activity, duplicate/late events, and normal one-shot behavior.",
      "risks": "A new fact could leak CLI concerns into Core or duplicate the existing lifecycle projection.",
      "rollback": "Revert only new typed facts and tests while retaining beta.4-compatible fixes; do not replace the event store."
    },
    {
      "id": "artifact-config-role-and-profile-chain",
      "depends_on": ["core-channel-facts-and-projections"],
      "target": "packages/cli/src/templates/trellis, Channel role/profile/config loading, artifact validation, and matching tests",
      "action": "Add the provider-neutral teammate role, profile/config resolver, canonical task-owned artifact schemas, init/update registration, and validators through the existing template owner. Require a bounded summary in each immutable brief and bind it to the frozen plan. Migrate legacy role/profile/artifact inputs read-only. Freeze role/context/profile/provider/model/options and capability digests in each attempt. Enforce identity, path, secret, symlink, protected-target, report, disposition, and source/terminal checks. Keep role text separate from host permissions.",
      "deliverables": "Template role/profile/config assets, artifact validator and fixtures, loader/resolver changes, compatibility tests, and generated-asset registration.",
      "verification": "CLI lint/typecheck, Python checks, artifact integration tests, init/update fixtures, missing-context and digest-mismatch failures, legacy compatibility, and protected write rejection.",
      "risks": "Template generation can create a second source of truth or silently overwrite project customization.",
      "rollback": "Stop before coordinator work if ownership/hash checks or legacy reads are ambiguous; keep historical artifacts untouched."
    },
    {
      "id": "runner-adapters-and-host-capability-gate",
      "depends_on": ["artifact-config-role-and-profile-chain"],
      "target": "packages/cli/src/commands/channel/adapters, supervisor, agent-loader, context handling, and adapter tests",
      "action": "Define and register provider-neutral capability contracts for Codex app-server, DSH ACP, Copilot ACP, and Claude Code CLI. Build the digest-bound launch specification, prompt/context injection, and read-focused write policy; require native delegation and recursive delegation to be disabled, permit only frozen explicit context, prove implicit host memory is unavailable, and fail closed for unsupported options, missing context, capability drift, or lifecycle ambiguity. Implement contract fixtures only: the PRD explicitly excludes external provider protocol execution and Paseo/Provider host gates. Keep host-gate checks separate from the FSM.",
      "deliverables": "Four provider contract registrations, capability snapshot, prompt/context injection path, write policy, contract fixtures, and an explicit real-host deferral record.",
      "verification": "Adapter contract tests, Codex/ACP/CLI contract fixtures, launch/context digest tests, unsupported-capability fail-closed tests, and proof that the batch entry point refuses dispatch without a host gate. No-real-host acceptance record.",
      "risks": "Provider protocols change independently and one adapter may accidentally expose recursive delegation.",
      "rollback": "Disable the affected adapter and return to planning; never silently fall back to native platform delegation or manual main-agent scheduling."
    },
    {
      "id": "coordinator-fsm-and-receipts",
      "depends_on": ["runner-adapters-and-host-capability-gate"],
      "target": "packages/cli/src/commands/channel existing namespace, coordinator modules, task-owned artifacts, and CLI tests",
      "action": "Implement the frozen batch coordinator in the existing Channel command/runtime owner. Validate plan hash and immutable work contracts; calculate positive effective capacity; atomically acquire the shared guard; fill and refill FIFO slots; maintain one waiter; write create-once claims/commands; route events; protect active/waiting executions from idle cleanup; validate reports and terminal facts; continue timeout-yield in place; create bounded complete retries after confirmed failure/rejection; reconcile uncertainty; and return one bounded control or business receipt. Normal Channel and task commands remain unchanged, and batch entry points fail closed before dispatch without the host gate.",
      "deliverables": "Coordinator FSM, capacity/guard/lease handling, command/claim correlation, receipt schema, recovery/cancel/reconcile paths, and deterministic tests.",
      "verification": "Tests for capacity formula and explicit over-limit rejection, FIFO rolling refill, guard contention, protected lease, timeout continuation, complete retry after execution failure or acceptance rejection, budget zero/exhaustion, duplicate/late events, crash recovery, cancel/drain, reconciliation, terminal/report ordering, all-accepted, settled-with-failure, and host-gate refusal.",
      "risks": "Incorrect handling of uncertain side effects could duplicate an external process or settle a report before its terminal fact.",
      "rollback": "Remove only opt-in coordinator entry points and new coordinator facts; preserve ordinary Channel behavior and earlier adapter/core tests."
    },
    {
      "id": "skill-template-and-normal-task-completion",
      "depends_on": ["coordinator-fsm-and-receipts"],
      "target": "bundled trellis-channel Skill, native task/template assets, generated mirrors, and tests",
      "action": "Rewrite bundled Channel guidance around frozen-plan submission, program-owned waiting, bounded receipts, resume/cancel/reconcile, and artifact boundaries. Add the ordinary implementation completion loop: update task status, compare implementation to design, select risk-proportional tests/review, add cases and fix/retest when needed, and append checkpoints. Remove manual per-event scheduling, fixed waves, self-retry, recursive delegation, unbounded waits, and worktree instructions from the new source. Preserve native task lifecycle and one-shot Channel guidance.",
      "deliverables": "Canonical Skill/template assets, generated registration, normal task completion contract, and source/mirror tests.",
      "verification": "Template/init/update and Skill tests; static scan for duplicate lifecycle owners; normal task/Channel regression tests; generated asset hash and provenance checks.",
      "risks": "A generated platform copy can retain an older coordination rule and reintroduce a second owner.",
      "rollback": "Stop before Marketplace integration if source/mirror or native task contracts disagree; do not restore a parallel workflow as a workaround."
    },
    {
      "id": "component-gates-and-acceptance-receipt",
      "depends_on": ["skill-template-and-normal-task-completion"],
      "target": "Trellis v0.7.1 component tree and owner task",
      "action": "Run complete component checks proportionate to the final diff, perform a source-to-design review, fix findings, and repeat affected checks. Verify that retained, migrated, and removed old-fork paths have an owner and caller/test evidence. Record deferred Paseo/Provider host gates, Marketplace main dependency, root gitlink boundary, and remaining release work. Do not claim production runtime readiness or publish.",
      "deliverables": "Final component test/lint/typecheck/Python receipts, review and repair checkpoint, owner completion record, and root coordination receipt.",
      "verification": "Core lint/typecheck/test; CLI lint/typecheck/focused tests; Python checks; generated/template tests; static FSM and ownership audit; clean diff review.",
      "risks": "Component checks can pass while host-gate or root consumer contracts remain unverified.",
      "rollback": "Keep the owner task in progress or return to planning when any contract is unproven; leave the root production pin unchanged."
    }
  ],
  "stop_point": {
    "condition": "All seven steps are complete on v0.7.1; component source, tests, templates, and config satisfy the approved design; focused and risk-proportional gates pass; findings are fixed and rechecked; deferred host/root/Marketplace work is recorded.",
    "observable_evidence": "Component task status and checkpoints, source-owner ledger, Core/CLI test receipts, template/provenance fixtures, adapter fail-closed fixtures, coordinator FSM/receipt tests, and a final static review against the root plan.",
    "remaining_work": "Marketplace main workflow retirement and candidate pin, root integration, host-gate implementation and real runtime validation, remaining fork recovery, and v0.7.1 release remain with the root coordination task or later owners.",
    "failure_exit": "Return the owner task to planning/replan and keep strict batch disabled when an owner, durable fact, state transition, capability boundary, artifact validation, or component gate cannot be proved. Do not add a second store, workflow, scheduler, or manual dispatch fallback."
  }
}
```
<!-- /trellis-implementation-plan:v1 -->
