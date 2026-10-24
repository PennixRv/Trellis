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
      "action": "Freeze the beta.4 source and package boundary. Compare every relevant beta.4-to-Pennix change in Core Channel APIs/reducers/store, CLI command/supervisor/adapters, template registration/config/role assets, artifact scripts, Skill sources, and tests. Record caller, owner, retained capability, new-contract rewrite, upstream coverage, removal, or deferral. Treat old fork artifacts as research evidence only; implement no old-format reader or migration. Run unchanged beta.4 focused baseline tests before editing.",
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
      "action": "Add the provider-neutral teammate role, profile/config resolver, canonical task-owned artifact schemas, init/update registration, and validators through the existing template owner. Define the new `teamwork.teammate` config schema; do not read or migrate old role/profile/artifact/config formats. Require a bounded summary in each immutable brief and bind it to the frozen plan. Validate exactly two distinct committee members with identical normalized full work contracts and distinct lens. Represent `counter_of` as a directed relation between two distinct work IDs in one batch; validate shared objective/context/acceptance/retry budget, distinct lens/execution identity, evidence identity disjointness, and absence of primary-report disclosure. Freeze role/context/profile/provider/model/options and capability digests in each attempt. Enforce identity, path, secret, symlink, protected-target, report, disposition, and source/terminal checks. Keep role text separate from host permissions.",
      "deliverables": "Template role/profile/config assets, artifact validator and fixtures, committee and counter relation contracts, loader/resolver changes, new-schema tests, and generated-asset registration.",
      "verification": "CLI lint/typecheck, Python checks, artifact integration tests covering committee pair count and normalized-contract match, counter relation validity, evidence overlap and bounded retry, init/update fixtures, missing-context and digest-mismatch failures, explicit rejection of old fork formats, and protected-write rejection.",
      "risks": "Template generation can create a second source of truth or silently overwrite project customization.",
      "rollback": "Stop before coordinator work if ownership/hash checks or new-format validation is ambiguous; keep historical artifacts untouched and do not add a compatibility reader."
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
      "action": "Implement the frozen batch coordinator in the existing Channel runtime owner under the new `trellis teamwork batch` public command. Validate plan hash and immutable work contracts; derive committee summaries in the terminal receipt from existing member outcomes without a group state machine. Check counter evidence identity disjointness before acceptance, reject only an overlapping counter report, and apply that work's frozen bounded retry; derive pair completeness from existing terminal work outcomes. Calculate positive effective capacity; atomically acquire the shared guard; fill and refill FIFO slots; maintain one waiter; write create-once claims/commands; route events; protect active/waiting executions from idle cleanup; validate reports and terminal facts; continue timeout-yield in place; create bounded complete retries after confirmed failure/rejection; reconcile uncertainty; and return one bounded control or business receipt. Preserve normal beta.4 Core Channel and task behavior under the renamed CLI; batch entry points fail closed before dispatch without the host gate.",
      "deliverables": "Coordinator FSM, capacity/guard/lease handling, command/claim correlation, receipt schema and derived committee/counter summaries, recovery/cancel/reconcile paths, and deterministic tests.",
      "verification": "Tests for capacity formula and explicit over-limit rejection, FIFO rolling refill, guard contention, protected lease, timeout continuation, complete retry after execution failure or acceptance rejection, budget zero/exhaustion, duplicate/late events, crash recovery, cancel/drain, reconciliation, terminal/report ordering, all-accepted, settled-with-failure, and host-gate refusal; test complete/incomplete committee projection, counter evidence-overlap rejection, retry budget exhaustion, and no report access before batch terminal.",
      "risks": "Incorrect handling of uncertain side effects could duplicate an external process or settle a report before its terminal fact.",
      "rollback": "Remove only opt-in coordinator entry points and new coordinator facts; preserve ordinary Channel behavior and earlier adapter/core tests."
    },
    {
      "id": "skill-template-and-normal-task-completion",
      "depends_on": ["coordinator-fsm-and-receipts"],
      "target": "bundled trellis-teamwork Skill, Teamwork CLI surface, native task/template assets, generated mirrors, and tests",
      "action": "Replace the old bundled Channel Skill with one `trellis-teamwork` entry that absorbs useful guidance and rewrites it for the new contracts. Register the entire beta.4 Channel command tree under the public `trellis teamwork` root, preserve each subcommand behavior, and provide no old root alias. Use the new `teamwork.teammate` config schema; preserve beta.4 Core Channel API/event/store names. Organize command, forum/thread, teammate-process, batch, independent-evaluation, and diagnostic guidance in on-demand references; rename the old process reference to `references/teammate-processes.md`. Update every in-repository caller, command help, template, `trellis-meta`, source registration, platform distribution, and test. Do not add old Skill/CLI/config aliases, old-format readers, or migrations. The injected `.trellis/agents/teammate.md` remains the generic participant behavior contract. Advisor is one ordinary work; committee uses the validated fixed two-member contract; `counter_of` uses the directed independent-evidence pair and identity-disjointness check. Keep reports hidden until terminal receipt. Add no specialist role cards, committee state, or Paseo convergence loop. Restore read-only `trellis task progress [--json]` for native lifecycle counts, excluding archived tasks and marking malformed or unknown records partial. Add the ordinary implementation completion loop: update task status through native commands, compare implementation to design, select risk-proportional tests/review, add cases and fix/retest when needed, and append checkpoints. Remove manual per-event scheduling, fixed waves, self-retry, recursive delegation, unbounded waits, and worktree instructions. Preserve native task lifecycle and beta.4 Channel semantics.",
      "deliverables": "Single Teamwork Skill/reference, Teamwork CLI and new configuration naming, renamed teammate-process reference, corrected workflows, generated registration, `trellis-meta` listing, platform distribution tests, normal task completion contract, and source/mirror tests.",
      "verification": "Template/init/update and Skill tests; verify bundle build/package/platform distribution and all renamed reference links; new CLI route, `teamwork.teammate` config, beta.4 Channel/task regression, and `task progress` counts/partial output; static scan for legacy aliases/readers/migrations, duplicate lifecycle owners, bypass recipes, and peer-dialogue loops; verify committee reports remain unavailable until batch terminal and incomplete groups are not reported as consensus, plus counter evidence-overlap handling.",
      "risks": "A generated platform copy can retain an older coordination rule and reintroduce a second owner.",
      "rollback": "Stop before Marketplace integration if source/mirror or native task contracts disagree; do not restore a parallel workflow as a workaround."
    },
    {
      "id": "component-gates-and-acceptance-receipt",
      "depends_on": ["skill-template-and-normal-task-completion"],
      "target": "Trellis v0.7.1 component tree and owner task",
      "action": "Run complete component checks proportionate to the final diff, perform a source-to-design review, fix findings, and repeat affected checks. Verify retained, rewritten, upstream-covered, and removed old-fork capabilities have an owner and caller/test evidence; confirm no old-format runtime readers or aliases were introduced. Record deferred Paseo/Provider host gates, Marketplace main dependency, root gitlink boundary, and remaining release work. Do not claim production runtime readiness or publish.",
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
