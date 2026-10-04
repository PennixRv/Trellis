# Retire external memory integration from workflow and Channel

## Goal

Execute approved root cognee-memory-base-removal plan: remove dedicated adapter/template requirements, publish CLI/core and update marketplace

## Requirements

- Execute root task `/home/penn/devel/codex-workflow-optimization/.trellis/tasks/10-04-cognee-memory-base-removal`, approved on 2026-10-04, on `pennix/v0.7-beta`.
- Remove dedicated external-base handling and descriptions from Codex adapter and bundled worker guidance; retain general SDK child, Channel, task identity and local session tools.
- Coordinate the independent Marketplace `main` workflow change before pinning its published SHA. Do not modify existing unrelated docs-site work.
- Publish version-locked CLI/core through CI, then update all root-enumerated consumers through native project update.

## Acceptance Criteria

- [ ] No active external-base requirement or dedicated runtime integration remains.
- [ ] Impact/change analysis and CLI/core validation pass; source and distribution templates agree.
- [ ] New beta published for both packages and consumer rollouts verified.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
