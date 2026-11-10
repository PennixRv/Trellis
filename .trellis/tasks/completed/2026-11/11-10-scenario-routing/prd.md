# 辅助 Skills 场景与五阶段条件连接

## Goal

执行根任务 pennix-skills-scenario-routing 已批准合同 WP2：原生模板条件入口与三包发布；不改阶段协议。

## Requirements

- 执行根任务已批准实施合同 WP2，修改原生 bundled workflow 与 start/continue/intake、必要阶段方法连接。
- 具体场景由可用 Skill 自身及其现有总路由拥有；不增加 Pennix 强制依赖、运行态或阶段协议。

## Acceptance Criteria

- [ ] 五阶段、启动、恢复和 taskless 入口按需使用当前宿主可用方法，保留阶段及授权。
- [ ] fresh-init/update、模板、类型、lint、build 和必需测试通过；无 Pennix 项目仍可用。
- [ ] CLI/core/paseo-adapter 三包同版本 CI 发布，原生安装后根验收通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
