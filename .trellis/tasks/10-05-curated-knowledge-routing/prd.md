# 澄清历史回溯与人工知识职责

## Goal

承接根SiYuan集成任务已批准设计；仅修改共同bundled session-insight及触发参考，配对beta发布和消费者更新，不更改mem/runtime。

## Requirements

- 主会话 inline 承接根已批准设计；不派发 implement/check。
- mem 是本地历史证据，当前源码/task/spec 为事实权威，人工知识由已配置原生 owner 负责；无强制检索/自动捕获。
- 只修改共同 bundled Skill/参考，不绑定特定知识产品，不改变 runtime。

## Acceptance Criteria

- [ ] 图影响/变更检查及既有 lint/typecheck/test/build/release 门禁通过。
- [ ] CLI/core 配对 beta 由原生 release helper 发布；registry 可见。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
