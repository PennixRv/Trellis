# Decision gates and replanning lifecycle

## Goal

Implement the approved Pennix decision-gate bridge and controlled replan lifecycle on the Pennix v0.7 beta branch.

## Requirements

- Keep `pennix-decision-gates` as the sole authority for decision graph state,
  frontier batching, native Codex question handoff, recovery and conflict audit.
- Let generic Trellis brainstorm retain task/PRD/final-approval ownership, and
  delegate only when at least two independent material decisions and a compatible
  Pennix gate are available; otherwise retain its existing single-question flow.
- Add task-local `decision-gates.json` only for delegated complex planning. A
  native question handoff is not a planning stop: answers must be recorded and
  the decision frontier recomputed until sealed and conflict-audited.
- Add `task.py replan <task> --reason <text>` for `in_progress -> planning` with
  audit, preserved task binding/branch and fail-open `after_replan`; do not add a
  task status, second lifecycle or runtime service.
- Extend Trellis Core phase parsing so every `create` or `replan` through its
  matching `start` is a planning interval, including conservative handling of an
  unmatched replan.
- Keep template update migration incremental: pristine templates update normally;
  user-modified templates remain intact and can receive `.new` candidates.

## Acceptance Criteria

- [ ] Pennix gate documentation/contracts describe batched independent questions,
  persisted recovery, conflict audit and continued planning after native input.
- [ ] Common and Copilot brainstorm surfaces capability-detect/bridge to Pennix
  gates while retaining a no-gate, single-question fallback.
- [ ] `replan` rejects invalid state/reason without mutation; success records an
  audit entry, preserves branch/binding, invokes `after_replan`, and allows a
  later ordinary `start`.
- [ ] `trellis mem --phase brainstorm` includes replan intervals without
  regressing legacy create/start and multi-task pairing.
- [ ] Relevant CLI, Core, template/update and Python task-script checks pass.
- [ ] The changes are committed and published as lockstep Trellis beta packages
  from `pennix/v0.7-beta`, then reinstalled without returning to a release branch.

## Notes

- Root planning task `09-22-trellis-codex-decision-chain-governance` holds the
  sealed decisions and research; this task implements them on the beta fork.
