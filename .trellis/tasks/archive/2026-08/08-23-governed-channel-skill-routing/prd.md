# Route governed channel requests away from implement workers

## Goal

Resolve Issue 144: make the bundled trellis-channel skill distinguish codex-only-analysis-channel projects from ordinary Trellis projects, preserving Pattern B only outside the governed profile.

## Requirements

- Add a mandatory profile-routing gate to the bundled `trellis-channel` skill before any workflow pattern is selected.
- When `.trellis/codex-workflow.json` proves the `codex-only-analysis-channel` profile with the governed `trellis-channel` backend, the skill must load `codex-workflow-dispatch` and must not route `implement` or `check` requests through Pattern B.
- In governed mode, the main session remains the owner of implementation, task facts, and Git; channel workers provide analysis/review evidence only.
- When the governed profile is absent or does not match the complete contract, the existing Pattern A/B behavior remains available for ordinary Trellis projects.
- Keep the bundled skill source as the single source of truth and verify that all platform collectors receive the same routing guard.

## Acceptance Criteria

- [ ] The bundled skill documents the exact governed profile predicates and the governed/non-governed routing split.
- [ ] Pattern B is explicitly marked non-governed-only and its implement/check examples are unreachable by the governed route described at the skill entry point.
- [ ] Regression coverage checks source text plus resolved bundled-skill output for every platform context.
- [ ] Existing ordinary channel workflow examples remain present for non-governed projects.
- [ ] `pnpm lint`, `pnpm typecheck`, the focused Vitest regression, and the relevant CLI test suite pass.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
