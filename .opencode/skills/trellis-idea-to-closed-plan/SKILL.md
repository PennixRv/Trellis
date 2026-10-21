---
name: trellis-idea-to-closed-plan
description: "Guides a Trellis task from intake through evidence, decisions, solution formation and review to a complete, explicitly approved plan; routes eligible direct and analysis-only work; triages post-closure changes and replans major changes. Use for new work, open planning, or changes to an active task."
---

# Trellis Idea to Closed Plan

Use this Skill to turn a new, changed, or newly blocked request into a complete, reviewed, explicitly authorized Trellis plan. This Skill owns planning and post-closure change triage. The Trellis CLI owns lifecycle state and receipts. Hooks and session utilities only route and display state. This Skill does not implement the task or edit `task.json`.

## Authority and state

Read the active task through `python3 ./.trellis/scripts/task.py current --json`, then read its `task.json`, planning documents, execution ledger, and current workflow. `task.status` is the task lifecycle; `task.json.meta.planning.stage` is the planning stage. Never infer one from the other, write either field by hand, or recreate old approvals. Use only native `task.py plan`, `start`, `replan`, and `archive` commands for transitions.

The planned change path is:

```text
planning/intake
  -> evidence
  -> decision_convergence (only while a material user choice is open)
  -> solution_formation
  -> solution_review
  -> user_review
  -> plan_closed
  -> start -> in_progress
```

The other authorized paths are:

- Task-based direct change: `intake -> evidence -> direct_ready -> start -> in_progress`; the CLI verifies the bounded direct contract.
- Analysis-only: `intake -> evidence -> archive`; it stays `planning`, records research evidence, and never starts implementation.
- Taskless direct work stays outside the task machine only while it remains one small, bounded, single-owner, reversible change with immediate verification. If it grows, create a task at `intake`.
- Completed or archived tasks are terminal. A follow-up gets a new task.

The CLI allows only documented `plan advance` edges. In particular, `intake` advances to `evidence`; `evidence` advances to `decision_convergence`, `solution_formation`, or a validated `direct_ready`; and later stages can return to `evidence`, `decision_convergence`, or `solution_formation` when their material preconditions hold. `plan_closed` is reopened only through `task.py replan` with an explicit earlier target stage.

## Route the request before editing

1. Determine whether the request belongs to the active task by comparing its goal, owner, repository, branch, component, scope, and acceptance. An independent deliverable gets a separate task and leaves the unrelated active task and ledger untouched. If bounded evidence cannot establish the relationship, ask the user to clarify before changing either task.
2. If the task is completed or archived, create a new follow-up task. Never reopen a terminal task.
3. Classify the work explicitly as `execution_class=planned|direct` and `delivery_mode=change_bearing|analysis_only`. Use planned work for multiple steps, material decisions, cross-component ownership, significant risk, or public/data/release changes. Use direct only when one named owner can perform one small, reversible change with immediate verification and a clear rollback. Use analysis-only only when the deliverable is evidence and the PRD states a no-change boundary for protected targets.
4. Create a task only when the user asked for one or explicitly agrees after you explain why Trellis tracking is needed. Creating a task does not approve its plan or implementation. `task.py create` creates a planning task at `intake`; set classification with `task.py set-meta`, then use `task.py current --json` to confirm the task and stage. Do not set reserved `meta.planning` through `create --meta` or `set-meta`.
5. Keep the stage unchanged while gathering and recording evidence. Persist verified facts and source paths in task research or PRD. Use project-specific code or search routing rules; a search result is evidence only after it is checked against the source.

## Evidence and stage progression

- Inspect repository-backed facts, applicable specs, and task history before asking the user to resolve questions those sources can answer. Keep evidence, source paths, unresolved facts, and a recoverable next action in the task's research or planning artifacts.
- Advance a stage only after its evidence and exit conditions are met. Missing evidence is not a resolved decision or a reason to claim the plan is closed. Use `$pennix-decision-grill` only for consequential choices the user owns.
- For read-heavy evidence, define a bounded question, evidence units, source authority, and a stop condition; delegate research only through the project's approved routing. If independent subnode dispatch is requested, record the exact question, units, scope, stop conditions, destinations, concurrency, and acceptance method, then obtain explicit approval before any spawn or send. That approval covers only the frozen dispatch.
- `analysis_only` (`task.json.meta.delivery_mode = "analysis_only"`) tasks may include complex or cross-owner evidence work and recommendations. Keep them in `planning`, verify the evidence deliverable and protected-target no-change boundary, then archive through the native CLI. Do not require `design.md`, `implement.md`, a planning seal, implementation approval, or `task.py start`; create a separate change-bearing task before acting on a recommendation that changes a protected target.

## Resolve decisions and form the solution

Use `pennix-decision-grill` for consequential user choices. Ask one high-priority, dependency-ready decision at a time; after each answer, update the decision record and reassess what remains. Do not ask users to choose facts, settled preferences, or local implementation details that can be resolved from evidence. If the request changes materially, incorporate it before proceeding.

Maintain one `trellis-decisions:v1` JSON block in `prd.md` while material decisions remain. Every decision has `id`, `status`, `question`, `evidence`, `answer_or_reason`, `impact`, and `reopen_when`. Record resolved decisions as `decided` or `deferred` with a reason; do not enter solution formation or review while any decision is `open`.

Write `prd.md` with a testable goal, scope, requirements, acceptance criteria, exclusions, confirmed facts, and decision evidence. For planned change-bearing work, write `design.md` with component boundaries, interfaces, data flow, compatibility, alternatives that matter, and operational risks. Then write `implement.md` with exactly one `trellis-implementation-plan:v1` JSON block. Each ordered step must include:

```json
{
  "id": "stable-step-id",
  "target": {
    "repository": "actual repository",
    "branch": "actual branch",
    "component_or_path": "owned component or path"
  },
  "depends_on": [],
  "action": "concrete work",
  "deliverables": "reviewable result",
  "verification": "commands and observable acceptance evidence",
  "risks": "material risks",
  "rollback": "specific recovery action"
}
```

Dependencies must refer only to earlier steps. Every step must have one actual owner and target. The JSON block must also contain exactly one `stop_point` with non-empty `condition`, `observable_evidence`, and `remaining_work`. The stop condition defines when this task is complete; remaining work names items outside this task. Do not leave generic, unbounded, or future-phase work inside the stop point.

Before final review, rewrite `prd.md` against the final artifact structure. Keep it lossless: preserve every confirmed fact, requirement ID, decision, constraint, source anchor, severity, and acceptance mapping; remove resolved questions and duplicates without dropping information. Fold temporary assumptions and resolved questions into the owning sections, merge overlapping defect and requirement lists while keeping evidence and anchors with the requirement, then read the PRD top to bottom to confirm no material is missing or repeated without purpose. Also confirm the goal, scope, exclusions, observable acceptance, resolved decisions, remaining technical unknowns, ownership, dependencies, compatibility, risks, verification, rollback, and stop point are consistent across the artifacts.

For `direct_ready`, record one change, one owner, bounded scope, immediate verification, and rollback in `prd.md`; the CLI validates these fields. For `analysis_only`, record the evidence deliverable and protected-target no-change boundary. Neither path should be padded with a planned implementation sequence.

Advance only after writing the material required by the target stage. Before solution review, check that all decisions are resolved and every implementation step has explicit order, dependency, repository/branch/path, deliverable, verification, risk, and rollback. Verify that the solution satisfies each acceptance criterion, addresses every material risk, and has one observable stop point. Fix gaps before advancing.

Before `plan seal` or `task.py start`, run native task validation and the applicable context checks. On subagent-dispatch workflows, `implement.jsonl` and `check.jsonl` must each contain at least one real spec or research entry; empty manifests or seed-only `_example` rows do not satisfy this gate. Inline workflows use their native context-loading path.

## Review, approval, and start

Run the applicable task-context checks before review. Inspect the full current documents and obtain the current digest with:

```bash
python3 ./.trellis/scripts/task.py plan digest <task>
```

Present the complete solution to the user: goal and exclusions, resolved decisions, repository/branch/component ownership, ordered steps and dependencies, acceptance and verification, risks and rollback, and the exact stop point. Ask whether to seal and approve this displayed plan or revise it. A task request, earlier design answer, or parent-task approval is not approval of this plan.

If the user asks for changes, update the materials, return to the earliest affected stage through permitted planning transitions, rerun validation, and present the revised complete solution. When the user explicitly approves proceeding with the displayed solution, run `plan seal <task> --expected-digest <shown-digest>`, use the returned revision with `plan approve <task> --revision <n> --basis <actual non-sensitive approval>`, then `task.py start <task>`. If the user approves sealing only, stop after seal. An empty reply, cancellation, or selection of a recommended option is not approval. On a command failure, inspect its output and actual task state before retrying.

The digest and seal cover the task identity, classification, and review documents. Material edits invalidate the prior seal and approval. `execution.md` is an unsealed progress/evidence ledger and is excluded from that digest.

## Classify changes after closure or direct start

For each new request, changed condition, or implementation discovery, first decide whether it is for this active task. Do not mutate an unrelated task. If the relationship is unclear, leave state and ledger unchanged and ask.

A change is **minor** only if the user authorized it (for requested work) and every approved commitment remains true: goal, scope, acceptance, decisions, owner/repository/branch/component, design and public/data/security/privacy/release behavior, dependencies, verification, risks/rollback, and unique stop point. For planned work, it must fit an approved step and its ownership. For direct work, the task must still meet every direct eligibility condition. A small edit that changes scope or acceptance is major. Bounded evidence gathering that cannot establish minor status also means major.

For a minor change, leave task status and stage unchanged, preserve the sealed plan, and append to `execution.md`: the approved revision/classification, trigger and evidence, why all commitments remain valid, affected step or direct contract, exact delta, and verification. Continue only after the authorized delta and verification are recorded.

A change is **major** if it changes any approved commitment, invalidates a material assumption, reopens a user decision, outgrows direct eligibility, changes ownership/target/dependency/verification/risk/rollback/stop point, or remains uncertain after bounded evidence. Stop work that depends on it, record the finding, then run native `task.py replan <task> --to <earliest-stage> <reason>`. Choose `intake` for goal/scope/classification/owner changes or direct work that outgrows eligibility; `evidence` when facts must be re-established; `decision_convergence` when a user decision is open; `solution_formation` when the solution or implementation contract changes; `solution_review` when only internal review must repeat; and `user_review` only when the complete solution and internal review remain valid but the user must approve that same material again. Replan invalidates the prior seal and approval. Rebuild the plan, present it, and obtain new explicit approval before dependent implementation resumes.

When an analysis-only evidence review is complete, verify its acceptance and no-change boundary, then archive from `evidence` with the native archive command and a concise result reason. For administrative abandonment, record the reason and use the guarded archive path. Do not treat `plan_closed` as completion or archive a task merely because planning is finished.
