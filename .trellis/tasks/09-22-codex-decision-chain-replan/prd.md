# Codex decision-chain replan bridge

## Goal

Implement the approved Pennix decision-gates bridge, controlled same-task replan lifecycle, and Core planning-slice support directly on pennix/v0.7-beta.

## Requirements

- R1: Trellis brainstorm must inventory evidence first and may delegate two or more independent material decisions to the Pennix decision-gates protocol without losing Trellis ownership of PRD, plan, and final approval.
- R2: The same task must support a controlled `replan <task-dir> <reason>` transition from `in_progress` back to `planning`, preserving the session binding and recorded branch, appending an auditable `replans.jsonl` event before changing status, and running an optional fail-open `after_replan` hook.
- R3: Replanning must route continuation back to the planning decision gate; implementation-time ambiguity must not open a native question popup or silently choose a material product decision.
- R4: `trellis mem --phase brainstorm` must include each planning interval created by `create`/`replan` until its matching `start`, while preserving historical `create`/`start` behavior and safe unmatched-event fallbacks.
- R5: The change must be projected into the generated common/Copilot templates, workflow/continue guidance, task script trees, Core types/adapters, specs, tests, and quick references with no stable-branch edits.

## Acceptance Criteria

- [x] `task.py replan` rejects missing/nonexistent tasks, non-`in_progress` tasks, blank reasons, and failed event writes without changing `task.json`.
- [x] A valid replan writes an append-only JSONL event, changes only the task status to `planning`, retains session/branch metadata, and invokes `after_replan` without making hook failure fatal.
- [x] A subsequent `task.py start` returns the task to `in_progress`; repeated replan/start cycles remain valid and do not duplicate state fields.
- [x] Brainstorm parsing recognizes quoted and shell-separated `replan` commands; phase windows cover initial and later planning intervals and retain old parser behavior.
- [x] Python regression tests, Core phase tests, template projection tests, GitNexus change detection, lint/typecheck, and the repository's relevant test suites pass.
- [ ] The beta package is published from `pennix/v0.7-beta`, installed locally, and the root catalog/evidence records the exact release and commit.

## Scope and constraints

- Modify only this Trellis beta worktree and its generated source templates. Do not merge or backport to the stable branch.
- Keep `pennix-decision-gates` as the user-facing decision protocol; Trellis supplies lifecycle and memory boundaries, not a second question engine.
- Preserve atomic JSON writes, task ownership checks, existing lifecycle hooks, and the fail-open hook convention.
- No new runtime dependency or target-host installer is required.
