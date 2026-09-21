# Pennix beta 全量查漏补缺与复发布

## Goal

审计 Pennix v0.7 beta 是否完整承载上游 beta、Pennix fork 语义、Marketplace 模板、发布产物和可复现安装；修复发现的真实缺口，完成测试、提交、推送、CI 发布和 npm 安装验收。

## Requirements

- 核对当前 `pennix/v0.7-beta` 与上游 beta 基线、Pennix stable `main` 的功能边界，明确每个差异是保留、迁移、替代还是有意不带入。
- 核对 Trellis CLI、Core、Marketplace 子模块、平台模板、bundled skills、`.trellis` dogfood 资产、迁移清单和发布脚本之间的一致性。
- 核对 beta tag、远端分支、子模块指针、npm 包和全新目录安装结果；不得把“源码存在”误报为“用户可安装且可复现”。
- 核对当前任务投影的跨仓库边界：根协调仓库的 `no_task` 不得被误报为 Trellis beta 丢任务；Trellis 的 `unbound` / `unbound_ambiguous` 不得被任何 beta 自有状态消费者降级为 `no_task`。CCH 的任务计数继续按其独立的 `task progress` 聚合契约验收，不把当前绑定任务与生命周期总数混为一谈。
- 对审计发现的真实缺口直接修复，并为行为缺口补最小回归验证；仅证据或历史台账问题则记录处置结论，不新增无必要抽象。
- 以当前 beta 发布链路生成下一个连续版本，完成 CI 发布、npm 包验证和隔离临时项目的初始化/更新/状态命令验收。
- 保持稳定 `main` 和 npm `latest` 不被 beta 发布改写；beta 改动只进入明确的 beta 分支和 `beta` dist-tag。

## Acceptance Criteria

- [x] 完成审计矩阵，逐项记录上游 beta、Pennix 语义、模板/Marketplace、发布/安装面的证据和处置结论。
- [x] 所有需要修复的源码、模板、测试或发布元数据已修复；没有未解释的关键遗漏。
- [x] `pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test` 及发布连续性/打包预检通过。
- [x] GitNexus 变更检测已运行，目标函数影响已检查，发布提交前工作树和远端状态明确。
- [x] 新 beta 版本已由 CI 成功发布，`@pennixrv/trellis` 与 `@pennixrv/trellis-core` 的 `beta` 指向新版本，`latest` 保持稳定版本。
- [x] 新版本在隔离临时目录完成 npm 安装、`trellis init --codex --yes`、`trellis update --dry-run` 和任务状态命令验收。
- [x] 任务记录补齐提交、CI、npm 和安装验收证据后归档；远端 beta 分支与本地一致。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
