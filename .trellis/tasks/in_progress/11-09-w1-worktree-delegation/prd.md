# W1 本地 Codex 工作树委派完整集成

## Goal

完成父任务 `/home/penn/devel/codex-workflow-optimization/.trellis/tasks/in_progress/11-09-paseo-based-parallelism-integration-design` 的 W1。需求、设计及真实批准引用该任务的 `implement.md`、`implementation-resumption.md`、`runtime-contract.md`、`sdk-adapter.md`、`agent-foundation.md`、`codegraph-worktree.md`、`component-and-acceptance.md`。本组件记录不改变父任务阶段或接受。

用户已明确批准实现、测试、集成、发布重装、生效及真实恢复验收，最新约束是全部由当前主会话完成，不使用子代理实施。源码、检查、提交与发布由当前主会话在本组件检出推进；根任务保有跨组件接受。

## Requirements

- 目标仓库与控制项目独立，支持有、无 Trellis 的原生工作树；冻结父授权、PRD、角色、模型及能力要求，准备与实施许可分离。
- 公共 Paseo SDK 独立可选包，Node >=22；基础 CLI/core 不依赖 adapter，保留 Node >=18.17。
- 创建和发送先落 intent；未知结果不得重放，准确资源映射和原生证据恢复；所有任务闭合消费者使用同一 resolver。
- 固定角色与按次投影分离，一个 bundled Skill 和共享节点方法；节点不进入主控阶段、不写任务状态、不嵌套实施。
- CodeGraph 使用每树 bound MCP；owner merge/FF 并验证目标分支 ancestry 后显式核销，取消保全资源。

## Acceptance Criteria

- [ ] 独立 Git 工作树、候选 containment、输入漂移、未知恢复及旧记录回归通过。
- [ ] SDK 请求字段、身份、公开入口、角色/设置与敏感输出边界通过。
- [ ] 构建、lint、typecheck、测试、三包同版发布与实际安装通过；真实并行和恢复由根任务 W4 验收。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
