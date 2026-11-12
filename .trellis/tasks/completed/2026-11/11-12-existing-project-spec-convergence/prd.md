# 通用 spec 入口重入与 bootstrap 闭环

## Goal

按根 existing-project-spec-convergence 第2版已批准合同实现原生补缺入口、受保护创建、bundled bootstrap 与回归；用户已授权发布部署重装，主会话直接实施。

## Requirements

- 复用根任务已接受的需求和第 2 版合同：普通旧项目 init 补缺失通用总入口，保全已有规范、来源、配置与任务。
- 修复本组件 native writer、bundled bootstrap、必要文档与回归；主会话直接实施。

## Acceptance Criteria

- [ ] 新旧项目入口、来源与安全反例回归通过，保持 spec 用户所有权。
- [ ] bundled 方法、文档、发行与根组合验收一致；固定版本发布并经原生部署验证。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
