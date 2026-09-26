# Parallel workflow core runtime

## Goal

Verify I05/I06 persistence and generation contracts and carry optional F11 spawned receipt metadata.

## Requirements

- Verify the three planned I05/I06 persistence/terminal-generation risk areas with deterministic focused checks.
- Add only the optional `spawned` event fields required by F11: resolved model/effort, profile, config path/digest, source fields, and override reason.
- Preserve old event JSON and projections when those fields are absent; do not add a second state machine or aggregate worker state.

## Acceptance Criteria

- [ ] I05/I06 focused checks produce an evidence-backed closed-no-change or minimal-fix result.
- [ ] F11 metadata is typed as optional and survives event parsing without changing old projections.
- [ ] Core handoff records base/after source snapshot and the exact focused check result.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
