# 输出独立会话身份并对齐交接合同

## Goal

task current JSON 增加与任务指针独立的原生 session_source；同步 Marketplace 交接文档，回归验证、beta 发布与消费者升级。

## Requirements

- 在pennix/v0.7-beta新增session_source=session:<native context key>或null，保留source/current_task/stale/error/candidates与退出码。
- 模板和dogfood一致，真实taskless/no identity回归。
- Marketplace现有main纠正Hindsight交接合同，固定新commit；连续beta/core同版release，native消费者升级。

## Acceptance Criteria

- [ ] CLI/core要求lint、typecheck、test，图影响/文本调用核对。
- [ ] Marketplace与组件提交推送、发布并核实npm、重装，与根协调任务组合验收后归档。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
