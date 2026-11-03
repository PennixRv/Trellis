# Native task 质量闭环与 checkpoint 补齐

## 目标

让 native Trellis task 在普通 sub-agent 与 Codex inline 两种执行入口中，都能按变更风险完成实现对照、测试与审查、问题修复和进度汇总。沿用现有 Phase 2、`trellis-check` 和原生 task 生命周期，不增加 workflow、状态或 Skill。

## 要求

- Phase 2.2 明确要求对照完整实现 diff 与批准的 PRD、design、implementation plan、验收标准和适用 spec。
- 根据复杂度与影响选择检查深度；对缺少覆盖的行为补充针对性用例，对状态/持久化/安全/公共接口/跨包或同等高影响修改，按需要增加独立复审。小改不得被要求重复形式化审查。
- 在批准范围内修复审查问题并重跑受影响检查；未通过或不能运行的必需检查必须留为失败/阻塞。
- 普通 dispatch 和 Codex inline 两个 `in_progress` breadcrumb 都要提示以上闭环，并要求在 `execution.md` checkpoint 汇总已完成、未完成、阻塞、改动路径、验证结果和下一动作。task 状态仍由原生命令管理，验收通过前保持 `in_progress`。
- 在现有模板测试中固定这些 workflow 契约；Trellis bundled workflow、Marketplace native mirror 和 `index.json` 摘要保持一致。

## 范围与约束

- 候选 Trellis 仅在既有 `v0.7.1` 分支修改；不创建或切换分支。
- Marketplace 仅在既有嵌套 `main` checkout 更新镜像、摘要及 owner 记录；不推送。
- 不修改根仓库 workflow、门禁、生产 gitlink 或生成资产；不接入当前工作流。docs-site checkout 由其 owner 管理，本任务不修改、不提交。
- 不新增 task 状态、workflow、配置项或独立 Skill；保留现有 `trellis-check` 通用检查职责。

## 验收标准

- [x] 2.2 明确对照批准方案、按风险决定测试和独立复审深度、修复并复验。
- [x] 两种 `in_progress` breadcrumb 均要求质量闭环与完整进度 checkpoint。
- [x] 模板回归测试覆盖 Phase 2.2 和两种 breadcrumb 的关键合同。
- [x] Marketplace native mirror 与 bundled source 字节一致，`index.json` SHA-256 正确，Marketplace 测试通过。
- [x] Trellis 受影响测试、全量检查和最终 diff 审查通过；候选 Trellis 只更新其 Marketplace gitlink。
- [x] 根仓库工作流/生产 pin、docs-site 工作树和所有远端状态保持未变。
