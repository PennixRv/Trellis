# Reconcile workflow assets and accepted research contracts

## Goal

Native beta.41 dogfood update, retain reviewed existing research contract corrections and marketplace history, synchronize accepted source and both checkouts.

## Requirements

- Native beta.41 update; adopt reviewed existing research spec/PRD corrections, preserve marketplace prior changes in Git and synchronize actual published source and both checkouts.
- Authorized by the user's explicit full reconciliation request; root plan: /home/penn/devel/codex-workflow-optimization/.trellis/tasks/10-09-workflow-footprint-reconciliation.

## Acceptance Criteria

- [ ] Both project native dry-run/provenance pass; accepted contracts/source Git pushed, existing work preserved and retired backups cleared; no runtime release needed.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
