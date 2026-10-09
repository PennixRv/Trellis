# Codex planning and evidence governance

## Goal

Implement the approved Pennix decision-chain, Planning Seal, evidence-unit, and subnode-v2 governance directly on `pennix/v0.7-beta`.

## Requirements

- R1: Trellis brainstorm must inventory evidence first and may delegate two or more independent material decisions to the Pennix decision-gates protocol without losing Trellis ownership of PRD, plan, and final approval.
- R2: The same task must support a controlled `replan <task-dir> <reason>` transition from `in_progress` back to `planning`, preserving the session binding and recorded branch, appending an auditable `replans.jsonl` event before changing status, and running an optional fail-open `after_replan` hook.
- R3: Replanning must route continuation back to the planning decision gate; implementation-time ambiguity must not open a native question popup or silently choose a material product decision.
- R4: `trellis mem --phase brainstorm` must include each planning interval created by `create`/`replan` until its matching `start`, while preserving historical `create`/`start` behavior and safe unmatched-event fallbacks.
- R5: The change must be projected into the generated common/Copilot templates, workflow/continue guidance, task script trees, Core types/adapters, specs, tests, and quick references with no stable-branch edits.
- R6 (superseded by root repair task `10-08-research-approval-gate`): `analysis_only` remains available for bounded evidence work with a protected-target no-change boundary regardless of complexity, cross-owner scope, recommendations, or unresolved product options. Main-session research needs no second implementation approval or Planning Seal. A requested subnode dispatch requires approval of a frozen task-owned evidence plan before spawn/send; approval covers only listed evidence work. Change-bearing implementation retains the native Planning Seal and later approval gate.
- R7: Read-heavy research, audit, review, and investigation must be decomposed into bounded evidence units that persist question/scope, evidence, conclusion or blocker, unknowns, and a recovery point before more reading; this applies to the main session and explicit subnodes.
- R8: Subnode artifacts must use report schema v2: exact per-scope assessments, evidence-linked structured findings and typed notes, plus bounded worklog checkpoints. Helper review concerns must remain distinct from coordinator acceptance.
- R9: Before a change-bearing task starts, the Planning Seal must reconcile every planning artifact and lock targets/branches, dependencies/release, validation/rollback, dynamic-fact handling/replan triggers, and all material decisions. Static ambiguity is prohibited.

## Acceptance Criteria

- [x] `task.py replan` rejects missing/nonexistent tasks, non-`in_progress` tasks, blank reasons, and failed event writes without changing `task.json`.
- [x] A valid replan writes an append-only JSONL event, changes only the task status to `planning`, retains session/branch metadata, and invokes `after_replan` without making hook failure fatal.
- [x] A subsequent `task.py start` returns the task to `in_progress`; repeated replan/start cycles remain valid and do not duplicate state fields.
- [x] Brainstorm parsing recognizes quoted and shell-separated `replan` commands; phase windows cover initial and later planning intervals and retain old parser behavior.
- [x] Python regression tests, Core phase tests, template projection tests, GitNexus change detection, lint/typecheck, and the repository's relevant test suites pass.
- [x] Common and Copilot planning templates, native workflow breadcrumbs, `continue`, and the Codex subnode workflow allow complex/cross-owner analysis-only evidence work in planning without implementation approval; requested subnode dispatch requires a frozen approved plan before spawn/send; change-bearing work retains the Planning Seal and `task.py start` gate.
- [x] `subnode_artifact.py` rejects v1 reports and malformed identity/schema structure, returns bounded `review_concern` output for recoverable checkpoint or coverage concerns, and keeps acceptance in the coordinator-only disposition path.
- [x] Source/dogfood task scripts and managed workflow/agent mirrors are byte-identical where the template contract requires it.
- [ ] The beta package is published from `pennix/v0.7-beta`, installed locally, and the root catalog/evidence records the exact release and commit.

## Scope and constraints

- Modify only this Trellis beta worktree and its generated source templates plus the required Marketplace mirror. Do not merge or backport to the stable branch.
- Keep `pennix-decision-gates` as the user-facing decision protocol; Trellis supplies lifecycle and memory boundaries, not a second question engine.
- Preserve atomic JSON writes, task ownership checks, existing lifecycle hooks, and the fail-open hook convention.
- No new runtime dependency or target-host installer is required.
