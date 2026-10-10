# 增强审查、验收、资源指引与 Codex mem 查询

## Goal

负责根协调任务 `workflow-principle-enhancement` 中 Trellis 的源码修改，包括模板指引、原生工作流镜像、Codex mem 查询行为、发布资产，以及 Trellis 项目自身的验收指引修正。本任务在当前修订完成原生封口前保持 planning；封口后仍须等待明确的后续批准。

## Requirements

- 修正 Trellis meta 参考资料中对生成/内置 Skill 的错误分类，并修正未依据当前已选工作流推导派发与提交路径的说明。
- 按主线 D14 增强 `check`：沿受影响行为检查既有实现、调用方、配置、测试和文档，按证据扩展，不默认完整模块/全仓审计；核实重要发现，按风险确定必要测试，不以 AC 未点名文件排除必要消费者。`finish-work` 在归档前对照本任务终点与实际验收证据，必需项未满足则返回对应工作。
- 为 `trellis-session-insight` 增加安全、有限且考虑资源的批量历史研究方法；明确 `--limit` 只限制输出，并说明本任务的内存优化范围仅为 Codex 小输出 `search`/`context`。
- 从思考指南源文件和 Trellis 自有副本中移除无依据的固定 35% reviewer 假阳性率，同时保留基于证据核实发现的要求。
- 不修改未选的 Native Workflow。增强当前已选 `codex-subnode-channel` 工作流及其直接关联的 Channel 参考：明确主会话 inline 实现/检查、显式 Channel 独立证据、Channel-driven 变体和 Channel worker 禁止递归之间的边界，并用针对性测试锁定允许/禁止路径。
- 在同一已选 workflow 的 Planning 阶段增加写入前目标分类：Planning Seal、后续批准和原生 `task.py start` 前只写 task-owned planning artifact；产品源码、测试、模板、配置和安装资产不得写入，测试要求只能进入执行计划。该项是阶段防错方法，不新增运行时拦截器或状态机。
- 让 Codex 小输出 `search` 和 `context` 不再保留完整对话正文，同时保留计数、相关性排序、以用户消息优先的摘录、上下文排序/窗口、压缩恢复、真实重复消息、标记和告警。完整 extract 与 phase API 保持不变；不改其余六个适配器，也不增加截断或大小阈值。
- 修复共享 JSONL reader 跨块 UTF-8 解码，并让 `context.maxChars` 成为严格上界。
- 如源码修改要求发布，按当前配对 beta 发布合同发布 CLI/Core；不得在本机直接发布 npm 包。

## Acceptance Criteria

- [ ] 模板源文件、Trellis 自有指南副本和 Marketplace 已选工作流及 Channel 参考说明彼此一致；Native Workflow 不改；针对性测试覆盖派发边界；项目受保护文件不被宽泛更新覆盖。
- [ ] Core 测试覆盖大体量 Codex 小输出查询、既有排序/计数/输出语义、压缩恢复/重复消息/告警、跨块 UTF-8，以及 `maxChars` 为 0、1 和正常值的情况。
- [ ] CLI/Core 的 lint、typecheck 和测试通过；模板进入 `npm pack --dry-run` 产物，且全新临时项目的安装/更新 smoke test 通过。
- [ ] 资源探测只使用本机合成 Codex 数据，并记录可比较的测量结果；不声称内存为常数，也不宣称已复现 Office WSL 的 OOM。
- [ ] 发布 manifest、配对版本、changelog、docs-site 与 Marketplace 子模块顺序符合 Trellis 发布流程；CI 在同一版本/tag 发布并验证两个包。
- [ ] 本任务当前封口修订未获后续明确批准前，不开始实施。
- [ ] Planning 阶段合同测试覆盖产品目标写入边界；当前产品工作树无本次误操作残留。

## 约束

- 源码分支：`pennix/v0.7-beta`；当前包版本为 `0.7.0-beta.43`，`.44` 只是候选，发布前必须重新核实。
- Marketplace 原生工作流位于独立子模块；更新 Trellis 指针前先推送镜像提交。
- 当前使用者消费 Marketplace `codex-subnode-channel`；Native Workflow 是未选变体，本任务不修改它。发布后根侧通过原生项目更新刷新当前选定工作流。
- 不访问 Office WSL 或真实会话数据。
