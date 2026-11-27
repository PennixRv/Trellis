# Protect shared Codex configuration and standardize delivery steps

## Goal

Root contract 6f809de3…: T1 shared Codex config ownership and T2 native workflow delivery checklist.

## Requirements

- Implement T1/T2 of the approved root implementation contract `6f809de3…` on `v0.7.1` (baseline `7daf05f4`). The root task owns phase acceptance and deployment.
- Guard the shared Codex project configuration at generation, update, removal, and restore entry points. Preserve keys outside Trellis ownership, even on forced or batch paths. Keep unrelated asset updates independent.
- Update the bundled native workflow and phase guidance to use numbered steps, prerequisites, observable evidence, and stops. Keep the existing acceptance and authorization model.

## Acceptance Criteria

- [ ] Isolated fixture covers init, refresh, preview, mixed TOML, forced update, removal and restore.
- [ ] Native workflow assets and existing task contracts stay compatible; package tests, typecheck, build and release checks pass before production update.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
