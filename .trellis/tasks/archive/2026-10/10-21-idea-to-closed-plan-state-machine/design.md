# Design: closed-plan state machine

## Authority and persistence

The Trellis CLI is the sole writer of `task.json.meta.planning`. It owns the current stage, material revision, seal, approval, lifecycle guards, replan, and migration. Skills, workflow documents, Hooks, and platform integrations read the record and call the CLI; none of them mirrors transition rules or edits the JSON directly. `task.status` remains the lifecycle field and is not reused as a planning stage.

The planning record keeps a single revisioned representation. A transition validates the current task classification, status, stage, and any stage-specific material before one atomic `task.json` write. Failed validation leaves the file unchanged. The digest includes the task identity, classification, and the complete review materials (`prd.md`, `design.md`, and `implement.md`) so a rename, classification change, or plan-document edit invalidates the user-review receipt. The unsealed `execution.md` progress ledger is excluded so an approved plan can accumulate execution evidence without invalidating its approval.

## Stage paths

- Planned/change-bearing work follows `intake -> evidence -> [decision_convergence] -> solution_formation -> solution_review -> user_review -> plan_closed -> start`; decision convergence is required only when a material user choice is open.
- A task-based direct change follows `intake -> evidence -> direct_ready -> start`, with the direct eligibility conditions checked by the CLI.
- Taskless direct work remains outside the task state machine. If it grows beyond its bounded, single-owner, reversible scope, create a task and return to intake.
- Analysis-only work follows `intake -> evidence -> archive`; it never reaches `plan_closed` or `start`.
- Replan preserves its existing guarded lifecycle operation for any `in_progress` task, including legacy tasks without a known source stage and direct tasks that outgrow their bounded scope; it additionally accepts `planning/plan_closed` to reopen an approved but not yet started plan. It increments the revision, clears old seal/approval receipts, sets `status=planning` and the explicit target stage, and records source status, nullable source stage, and target stage. Archived or completed tasks are terminal and cannot replan; follow-up work starts in a new task. Archive remains an end operation, not a synonym for plan closure.

## Native interface

Add constrained `task.py plan advance <task> --to <stage>` and read-only `task.py plan digest <task>`. `advance` accepts only documented edges and checks required documents/blocks before writing. `plan seal --expected-digest <digest>` records the exact material shown in `user_review` and leaves the stage there. `plan approve` records the user's explicit approval for that same revision and moves it to `plan_closed`; `start` rechecks revision, digest, classification, seal, and approval before changing lifecycle status. `task.py replan <task> <reason> --to <stage>` accepts any `in_progress` task and a `planning` task only when its stage is `plan_closed`; it requires a non-empty reason and a re-entry planning stage, writes a native event containing `from_status`, nullable `from_stage`, and `to_stage`, increments revision, clears prior seal/approval, and leaves the task in `planning`. The Skill supplies the impact assessment and earliest affected stage; the CLI checks only explicit inputs and legal state transitions.

The complete-plan validator parses `trellis-decisions:v1` and `trellis-implementation-plan:v1` blocks. It rejects open decisions, missing required fields, duplicate identifiers, unknown or forward step dependencies, absent repository/branch or verification ownership, and missing/multiple stop points. The stop point is a single explicit completion condition, not a list of future work.

## Post-closure change triage

The planning Skill model first decides whether a new user request belongs to the active task. An independent deliverable starts its own task at `intake` and does not change an unrelated task's state or ledger. If bounded context gathering cannot establish whether a request belongs to the current task, leave that task unchanged and clarify the relationship with the user. Archived or completed tasks are terminal; a follow-up starts a new task instead of reopening the terminal one. For a request or discovery belonging to the current task, the model owns the semantic assessment after `plan_closed` or during work started through `direct_ready`. It compares the change with the current approved plan or, for direct work, its recorded single-change/owner/verification/rollback contract. The CLI does not decide whether a change is minor or major; it enforces the state/revision transition explicitly selected by the Skill.

A change is minor only when every applicable baseline commitment remains intact: goal, scope, acceptance, resolved user choices, owner and repository/branch/component, design and public/data/security/privacy/release contracts, dependency order, verification, risk/rollback, and the unique stop point. A small request that changes the current task's approved scope or acceptance is major; an independent deliverable gets a separate task. For planned work, the delta must fit an approved step and its existing ownership. For `direct_ready` work, the task must still meet the single-change, bounded, single-owner, reversible, immediately verifiable direct criteria. The Skill keeps `task.status` and `planning.stage` unchanged, leaves the sealed planning documents untouched, and appends an `execution.md` entry containing the approved baseline revision/classification, trigger and evidence, minor rationale, affected step or direct contract, actual delta, and verification. This is execution evidence, not a second lifecycle ledger.

A change is major if any approved commitment changes, a material assumption becomes false, a substantive user choice must reopen, the direct eligibility contract no longer holds, or the model cannot establish that all minor conditions hold after bounded evidence gathering. Stop work that depends on the change, record the finding, and invoke native replan with the earliest affected stage: `intake` for goal/scope/classification/owner changes and any direct task that outgrows its eligibility; `evidence` when facts must be re-established; `decision_convergence` when a material user choice is open; `solution_formation` when the solution/steps/verification/risk/stop point must be revised; `solution_review` when only the internal review must be repeated; or `user_review` only when the complete solution and its internal review remain valid but the user must review and approve the same material again. Replan invalidates the old seal and approval. No implementation depending on the major change resumes until the revised complete plan is reviewed and explicitly approved.

## Migration

`task.py plan migrate` consumes a frozen manifest of task paths, source digests, and approved target dispositions. Dry-run validates every row and reports the exact before/after metadata without writing. Apply rechecks the full manifest before the first write, applies only planning metadata, and records per-task results. A failure restores all task JSON files changed by that invocation. Rollback is conditional on the post-migration digest still matching the receipt, so later task edits are never overwritten.

The migration leaves all pre-existing `in_progress` tasks' status, documents, approval, and evidence intact; it does not infer their historical stage or create an approval. The one `planning` benchmark task is classified from its existing materials and enters `intake` without a seal or approval. Only the 21 paths frozen in the coordinator baseline are eligible.

## Entry routing and generated assets

The sole planning entry is `trellis-idea-to-closed-plan`. It forms evidence and decisions, produces the complete plan, performs the solution review, presents the full materials, and invokes native transitions only after the corresponding conditions hold. After plan closure it also owns the model-led minor/major impact triage and unsealed execution-ledger entries; major changes stop dependent work and return through native replan. It does not implement the task or write `task.json`.

Commands, workflow template, Skills, Hooks, and session utilities route to this entry and expose the current CLI stage as read-only context. Migration of the old generated `trellis-brainstorm` path is hash-gated: delete only a file proven unchanged from the old managed template; preserve and report modifications or missing ownership records.

## Marketplace checkout and CI

After the root integration gate has taken over all cross-repository workflow assertions, remove only the Marketplace submodule from Trellis. Recheck object reachability, clean status, and extra worktrees immediately before removal. Keep `docs-site`, change CI and publish checkout to initialize it explicitly, and ensure the Trellis CLI test suite no longer reads Marketplace paths.

## Verification boundary

The Trellis owner task verifies its CLI, script-template parity, generated routing safety, and submodule/CI changes. The Marketplace owner task validates the workflow source and index. The root coordinator materializes installed project assets, runs the cross-repository integration gate, migrates the 21 frozen tasks, pins accepted component commits, and verifies the final stop point.

## Internal plan review

The owner scope stays within Trellis source, tests, specs, generated templates/callers, migration tooling, and the nested Marketplace submodule/CI boundary. The implementation steps cover the lifecycle contract before CLI changes, CLI before Skill/workflow routing, and the root integration gate before submodule removal; Marketplace source edits and the 21-task migration remain with their designated owner steps. The plan keeps source changes on `pennix/v0.7-beta`, preserves replan for legacy in-progress tasks, rejects terminal-task reopening, and tests independent-task routing, ambiguity without mutation, small scope changes as major, minor ledger continuation, approval invalidation, and template parity. No owner-level design decision remains open; code checks remain pending until the current plan revision is approved.
