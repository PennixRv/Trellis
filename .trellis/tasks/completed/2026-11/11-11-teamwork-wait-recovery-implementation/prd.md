# Teamwork 等待句柄丢失恢复实现

## Goal

承接根任务 teamwork-lost-wait-handle-recovery 已批准合同 v2，当前主会话直接完成原生观察、定位 Hook、异常退出桥接及连续发布部署；本地仅做组件归属记账，不另起规划或授权。

## Requirements

- 承接根任务 `teamwork-lost-wait-handle-recovery` 的已接受合同 v2 与真实用户授权；根资产在 `../.trellis/tasks/in_progress/11-11-teamwork-lost-wait-handle-recovery/`，本目录只记录组件归属，不另建方案或请求批准。
- 当前主会话直接实施、检查并完成发布部署；用户明确禁止子代理实施，不启动 `codex exec`、Teamwork 或 Paseo 委派写入。
- 产品范围为既有 reconcile 有界只读观察、定位投影／共享 Hook、死协调进程显式恢复桥接、相关测试和必要文档。保持冻结身份、deadline、容量及报告接受规则。
- 工作分支 `fix/teamwork-lost-wait-handle-recovery`，源码基线 `7a2d5222ec9d644ce07700e51ff039cbe0b149b9`。不重建图索引，不修改 Context Mode 或 Paseo。

## Acceptance Criteria

- [ ] 根合同五条接受条件有实际测试和组合证据。
- [ ] 既有调用兼容，合法恢复可达，未知退出和错批次继续阻断。
- [ ] 固定发行、原生部署／重装及受影响项目资产与源码身份一致。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
