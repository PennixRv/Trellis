# Trellis 源码修改设计

## 范围与归属

本组件任务负责 Trellis CLI/Core 源码、当前已选 Marketplace 工作流及其直接关联 Channel 参考、Trellis 自有 spec 副本、测试和发布资产。根协调任务 `workflow-principle-enhancement` 负责跨组件验收和根仓库自有文件。Pennix Skills 任务负责 `pennix-decision-grill`、`pennix-chinese-tech-writing`、lifecycle catalog 和 Pennix 项目自有副本。未选的 Native Workflow 不在本次修改范围内。

## 模板修改

- `common/skills/check.md`：按主线 D14 以变更为入口，沿受影响行为核查既有实现、实际调用方、配置、测试和文档，发现可能影响任务结果的旧问题时按证据扩展。对重要发现依据当前需求和证据核实，并记录有意义的反面证据；区分必要消费者与无关文件。用风险和行为判断必要测试，修正“新函数必配 unit test”和“AC 未点名文件即越界”的机械表达，不默认整模块/全仓审查。
- `common/commands/finish-work.md`：归档前，对照本任务终点和验收条件与实际检查结果；准确报告通过、未运行、受阻和证据有限的项目。必需验收未满足时返回对应工作，不以说明限制替代完成；复用已有证据，保留现行 dirty-path 与 scoped commit 行为。
- `common/bundled-skills/trellis-session-insight/SKILL.md`：增加按需的批量历史研究方法：先确定项目、平台、日期和问题；先检查元数据及小样本；过滤后再提取；控制输出范围；大规模读取前先用合成数据测试；发生资源压力时停止并记录进度。明确 `--limit` 只限制呈现输出。不得承诺完整 extract 或非 Codex 适配器有固定内存上界。
- `common/bundled-skills/trellis-meta/references/customize-local/change-skills-or-commands.md`：依据实际模板/源码位置与生成归属分类，并纳入第五个内置 Skill `trellis-research-record`；不得仅凭短名单或 Skill 名称推断项目所有权。
- `common/bundled-skills/trellis-meta/references/local-architecture/workflow.md`：说明行为取决于当前选择的工作流和任务阶段；删除与受支持流程冲突的通用自动派发、重复提交确认和 dirty tree 断言。
- `markdown/spec/guides/index.md.txt` 及 Trellis 自有 `.trellis/spec/guides/index.md`：只移除没有依据的 35% 估值，保留按实际代码核实发现的要求。
- `packages/cli/src/templates/trellis/workflow.md` 与 `marketplace/workflows/native/workflow.md` 只作为未选 Native Workflow 的不变对照基线，本任务不修改它们。当前任务的授权和推送边界以已选 `codex-subnode-channel` workflow 及其现行发布合同为准；不把 Native 的差异语义套入当前项目。
- 当前选定的 Marketplace `codex-subnode-channel/workflow.md` 与其消费落点应明确 inline 与 Channel 的分层：主会话完成普通实现/检查；显式 Channel subnode 只承载经授权的独立证据；Channel-driven 工作流是独立变体；Codex Channel worker 内部不再递归派发 native agent。`trellis-channel` 的通用 implement/check 示例注明由选定 workflow 决定是否适用，`multi-target-dispatch.md` 明确 inline 不派发 native implement/check。Native Workflow 文件、runtime 和项目配置不改。
- 在当前选定 workflow 的 Planning 状态块和 Phase 1.3/1.4 说明中增加写入前目标分类：先确认目标是 task-owned planning artifact、原生任务状态记录还是 protected product target；在 Planning Seal、后续批准和 `task.py start` 前只允许前两类，产品源码/测试/模板/配置/安装资产的测试要求写入 `implement.md` 或验收计划。合同测试只锁定这一文本边界，不模拟运行时拦截。

## Codex mem 查询方案

保留公开 API 类型和完整 extract/phase 实现。增加供 search 与 context 使用的内部 Codex 对话遍历器，避免两个小输出查询都构造包含所有 `DialogueTurn` 正文的数组。将压缩恢复时用于重复消息计数去重的完整文本键改为紧凑指纹与计数。Search 保留准确计数，并仅保留各角色所需的 top excerpts；跨会话排序和 `totalMatches` 仍须基于全部候选计算。Context 使用紧凑排序元数据完成选择，再次读取 Codex JSONL，仅收集入选窗口中的 turns。调整压缩边界恢复历史后的最终索引。保留告警去重，以及 encrypted inter-agent / assistant-loss 提示。

该方案将被保留的对话正文限制在最大单条解析事件和查询输出附近；指纹映射、命中/索引元数据仍会随不同 turns 或命中数增长。不得声称常数内存。单条最大 JSONL 记录、文件系统缓存、元数据和完整 extract 输出仍会产生资源开销。其余适配器明确不在本次实现范围。编码时先确认遍历器能否复用现有 Codex 解析 helper，避免重复解码或过滤逻辑；若不能复用，只抽取最小的私有共享 helper。

共享 bug 修复独立于 Codex-only 资源范围：在 `internal/jsonl.ts` 使用 `StringDecoder` 或等价的字节续接方式，保留跨越 256 KiB 边界的多字节字符，包括末尾未带换行的记录；更新 `selectContextTurns`，确保所有输入值和适配器均满足 `budgetUsed <= maxChars`。

## 验证与发布

Core mem 测试应对照现有 fixture 检查准确计数/排序/顺序、压缩恢复与重复消息、context 命中和 around 窗口、告警行为、extract 合同、JSONL EOF/分块边界及严格字符预算。合成资源对比用于补充证据，不设脆弱的 RSS 门槛。CLI 模板和 Marketplace 当前选定 workflow 测试检查内容及派发边界；不把 Native Workflow parity 当成本次目标。

Core 源码和内置 CLI 模板的改动要求按 Trellis beta 发布合同同步发布 CLI/Core。遵循 `cli/backend/release-process.md`：核实当前远端状态后选择下一个有效 beta 版本；添加 manifest 和双语 docs-site changelog/索引；先推 docs-site 与 Marketplace 子模块提交，再更新父仓库指针；运行完整质量检查、发布前置检查、pack 和全新项目 smoke test；仅通过 GitHub Actions 发布 npm 包。无需兼容分支或迁移；除非实施证据显示行为有破坏性，否则发布元数据按非破坏性修改处理。
