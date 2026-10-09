# 在途补充规则工作流同步

## Goal

Owner task for the Marketplace workflow and bundled CLI template synchronization; coordinated by the root task.

## Requirements

- 在 Marketplace `codex-subnode-channel` workflow 中明确：执行中的用户明确低风险同任务增量可继续，材料变化或不确定仍须 replan。
- 将同一规则同步到 Trellis CLI bundled workflow template，更新 Marketplace SHA-256 index 和回归测试。
- 保持现有 task.py 生命周期、封存摘要和材料变化门禁不变。

## Acceptance Criteria

- [ ] Marketplace source、index digest、测试和 bundled template 通过 parity/回归验证。
- [ ] 不新增状态机、调度器或隐式审批路径。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
