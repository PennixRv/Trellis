# 并行证据与规划切换原生合同修复

## Goal

实施根协调任务版本2：unit_plan准入、FIFO顺序、select与plan seal/approve/start/replan、bundled Skills/Hook，以及 Channel CLI 冗余默认参数收敛；paired beta 发布

## Requirements

- Root coordination task 10-06-parallel-audit-dispatch-fixes version 1 was explicitly approved after its final summary. Implement unit_plan admission, FIFO claims, task select and reserved native planning seal/approval/start/replan, shared Hook and bundled Skills. Preserve inline native implementation/check boundaries and legacy report reads.
- Main session writes and verifies; separate owner commits and paired beta release. Do not resume the parent workflow audit.
- User-approved CLI fix: `--profile` alone selects the `subnode` role and inherits its Codex provider; author `--as` defaults to `TRELLIS_CHANNEL_AS` or `main`. Omit equivalent process-cwd overrides in ordinary examples. Keep unique worker IDs, kill targets, recipients and filters explicit; update CLI specs/examples and add profile/actor regression coverage.

## Acceptance Criteria

- [ ] Native boundary, report compatibility and selected task/Hook tests pass; graph, lint/typecheck/tests/build/package gates pass; paired release and consumers verified by root coordination.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
