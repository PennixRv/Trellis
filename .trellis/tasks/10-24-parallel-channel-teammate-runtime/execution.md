## 2026-10-24 实施检查点

- 组件任务已在 `v0.7.1` 分支上运行，起点为 beta.4。步骤 1–6 已有源码或
  资产落地；步骤 7 仍待全量检查和源码对方案的复核。
- Core 负责协调事实、状态迁移校验、幂等事件追加、回放投影、lease、claim、
  command 和 receipt。CLI 负责固定计划 coordinator、工件/config/profile 合同、
  adapter 能力闸门和 fail-closed 的 `channel batch` 入口。既有单代理 Channel
  命令和原生 task workflow 保持不变。
- 当前确定性收据：Core 协调测试 `3 passed`；CLI coordinator/artifact/config/
  adapter 测试 `14 passed`；Core 和 CLI `tsc --noEmit` 通过。平台模板测试仍有
  一个已知失败，原因是受保护的 Marketplace/docs-site checkout 内容与 beta.4
  镜像不同；未修改受保护 checkout。
- 剩余工作仅包括全量构建、测试、lint、Python 检查、GitNexus 变更检测、完整
  diff 复核和任务验收记录。真实 Paseo/provider/CLI 宿主执行按已批准的静态
  验收边界延期。

## 2026-10-24 最终静态验证收据

- 实施步骤 1–7 的代码、模板、Skill、任务资产和测试已落地在唯一 `v0.7.1`
  分支；普通 Channel/task 入口保持 beta.4 行为，`channel batch` 在未安装并验证
  宿主 adapter 时于读取计划前 fail closed。Marketplace、docs-site 和受保护
  gitlink 未修改。
- Core 全量测试：`22 files, 402 passed, 1 skipped / 403`；CLI 全量测试：`89 files,
  2066 passed, 2 skipped / 2069`，唯一失败是受保护 Marketplace/docs-site checkout
  与 beta.4 bundled workflow 不一致的既有镜像断言。新增 coordinator、artifact、
  config/profile、adapter 测试在全量及定向运行中均通过，定向为 `14 passed`。
- Core/CLI `tsc --noEmit`、Core/CLI build、Core/CLI ESLint、CLI `basedpyright`
  均完成；Python 检查为 `0 errors, 68 warnings`，`git diff --check` 通过；任务
  `task.py validate` 通过（implement/check 各 6 个条目，只有已知大 spec 截断警告）。
- CodeGraph 已复核既有 `ChannelEvent`、`registerChannelCommand` 和普通 Channel
  入口的调用边界；GitNexus 变更检测为 `11 files / 16 symbols / 15 processes / high`
  风险，新增符号因索引尚未同步不作为低风险证据，已由当前源代码、类型检查、lint
  和测试补充验证。未提交、未推送、未发布。
- `prettier` 未安装在 beta.4 workspace，故窄范围格式检查未运行；其余静态/行为
  检查已完成。真实 Paseo/Provider/CLI 宿主执行、Marketplace owner 任务和正式
  v0.7.1 发布均属于后续范围；组件任务仍保持 `in_progress`，停在静态验收可继续
  的现场。

## 2026-10-24 执行期补充审计分类

- 本轮依 `trellis-idea-to-closed-plan` 将发现的两个缺口归入既有步骤 4 与步骤 6：host
  capability 增加隐式记忆隔离的 fail-closed 证明；Copilot 的旧 `parallel.prompt.md`
  未被生成器消费且包含冲突的手工调度指引，因此移除，并核实平台仍通过现有 bundled
  Channel Skill 获得批次合同，不新增并行入口。
- 这两项不启用 provider runtime、不建立第二条并行工作流，也不更改任务生命周期；实现前
  先将本记录作为执行期差异收据。相关 source、测试和 owner-ledger 会在修复后更新。
- 根研究审计还记录了旧 fork `counter_of` 独立反证关系，但组件 PRD/design/implement 未
  纳入该冻结计划数据关系。因增加此字段会改变 work-unit/schema 合同，标记为
  `decision-needed`；本轮不在未重审方案前扩展 schema。当前不依赖该字段的缺口修复可以继续。

## 2026-10-24 最终差异审查与复验

- 校正上节最初对 Copilot prompt 的描述：源码跟踪确认 `collectCopilotTemplates()` 不调用
  `getAllPrompts()`，旧 `parallel.prompt.md` 实际从未进入生成文件集；它虽不可达，仍被
  prompt 枚举 API 暴露且包含手工/worktree 调度冲突指引，现已删除并测试不再可发现。
  平台生成仍由共享 `resolveCommands()` 与 `resolveBundledSkills()` 提供现有 Channel 路径。
- 逐项对照锁定的七步计划、PRD、组件规范及源差异；Core、CLI runtime、模板/Skill、测试、
  规范和任务记录的 37 个变更路径均在 `research/owner-ledger.md` 有 owner 与验证项，包含
  被删除的 Copilot prompt。未发现其它未登记的组件路径。CodeGraph 对现存 Channel 公开入口
  与调用者完成复核；本轮新增未索引符号以实际源码、TypeScript、ESLint 和测试验证。
- 最终验证：Core build/lint 通过，Core 22 files、404 passed、1 skipped；CLI lint、
  typecheck、build、`basedpyright` 通过（0 errors、68 warnings）。CLI 定向 4 个文件
  84 passed；全量 89 files、2083 passed、2 skipped、1 failed。唯一失败仍是受保护
  Marketplace native workflow 镜像不等于 beta.4 内置 workflow；Marketplace 未改。`git diff
  --check` 与原生 `task.py validate` 通过，后者只报告已知大 spec 注入截断警告。
- 全量测试日志还打印模板测试故意触发的旧 `task.py init-context` 诊断文本；该测试断言
  已移除命令会给出迁移说明并通过，不是额外失败。
- 静态验收仍未闭合：Marketplace 镜像失败待其 owner 处理，真实宿主执行按 PRD 延期，
  `counter_of` work-unit 关系仍是需重新审定的 schema 决策。任务保持 `in_progress`；本次
  仅形成可审阅的本地语义提交，不发布、不推送、不关闭任务或创建分支。

## 2026-10-24 方案逐项对齐复核

复核基准为当前 PRD、设计、七步实施计划、适用 Core/CLI 规范、实际差异、测试及
CodeGraph 调用关系。组件 task 仍为 `in_progress`，分支仍是唯一既有 `v0.7.1`；未
创建分支或 worktree。步骤 1–6 的实现与定向证据已对齐；步骤 7 的全量 CLI 测试
仍有一个受保护 Marketplace 镜像断言失败，因此不勾选 PRD 验收项，也不关闭任务。

| 计划步骤 | 对齐状态 | 方案要求与实现证据 |
| --- | --- | --- |
| 1. beta.4 基线与 owner ledger | 已完成 | 固定源基线 `be9e19b269c25cb2787489eb81062bf96619442c`；`research/owner-ledger.md` 记录旧 fork 的保留、迁移、移除边界、受影响调用方、所有组件变更路径与对应测试。根仓库的 `docs-site` / `marketplace` gitlink 状态在实施前已存在，作为外部 owner 范围保留。 |
| 2. Core Channel 事实与投影 | 已完成 | 新增事实和批次投影继续使用 Core 现有 Channel JSONL、幂等追加及公开子路径；批次内实体 ID 按 `batchId` 隔离，重复/迟到事件和 terminal 事实由投影处理。跨批次 ID 回归已覆盖；Core 全量 22 files、404 passed、1 skipped。 |
| 3. 工件、配置、角色与 profile | 已完成 | CLI owner 实现 task-owned brief/queue/claim/worklog/report/disposition 校验，固定摘要与摘要绑定，角色/profile/provider/model/options 解析及模板注册；拒绝身份、路径、来源、终态、secret、symlink 和摘要不一致。工件与 profile 定向测试共 11 passed；模板配置器测试 57 passed。 |
| 4. Runner adapter 与 host capability gate | 静态合同已完成；真实宿主按方案延期 | Codex app-server、DSH ACP、Copilot ACP、Claude Code CLI 四项合同均登记；launch 构造会校验 host capability、context digest 和 profile options，原生委派及隐式记忆隔离均须通过 host capability fail-closed 检查并进入 digest 快照。复核发现 adapter 合同检查漏验 `supportsInterrupt`，已补检查并新增回归；测试对共享 adapter 的临时改动在 `finally` 中复原。当前公开 `channel batch <plan>` 入口在读取计划前固定拒绝，因为尚无已验证宿主接入；确定性测试通过注入 host/runtime 直接覆盖 coordinator。真实 Paseo/Provider/CLI 协议执行和宿主接入按 PRD 明确不属于本任务，不能据此宣称生产可运行。 |
| 5. Coordinator FSM 与 receipt | 已完成静态实现及关键分支复验 | 单一 coordinator 负责冻结计划、容量/共享 guard、FIFO 滚动补槽、claim/command、protected lease、等待/续跑、报告终态校验、每工作单元有界完整重试、取消和 reconciliation，并只返回汇总 receipt。超时续跑不消耗完整重试；执行失败或验收合同拒收才可在预算内创建新 attempt。修复续跑上限耗尽时误终结并释放 lease 的路径，以及 reducer 跨批次复用 ID 的冲突；拒收报告重试、timeout 保持 lease、terminal 前不读报告均有回归。Coordinator 11 passed；Core 投影 5 passed。 |
| 6. Channel Skill、模板与普通任务完成环 | 已完成 | bundled Skill 将固定计划提交和批次收据路由至 `references/teammates.md`；既有 `spawn/run` 命令及其原始参考保持上游兼容。implement/check 模板要求及时更新任务执行记录、对照 PRD/design/plan、按风险选测、补用例、修复并重跑。Copilot 生成器通过 `resolveCommands()` 与 `resolveBundledSkills()` 输出现有合同；旧 `parallel.prompt.md` 不在生成链路中且含冲突的手工/worktree 调度指引，已删除并由模板测试确认不再作为可发现 prompt 暴露。 |
| 7. 组件门禁与静态验收收据 | 未闭合 | Core/CLI lint、typecheck、build 和 CLI `basedpyright` 均退出 0；Core 全量通过。CLI 全量 89 files、2082 passed、2 skipped、1 failed。唯一失败为 `marketplace native workflow mirror matches the bundled workflow`：测试读取受保护的 `marketplace/workflows/native/workflow.md` 并要求与 Trellis beta.4 内置 workflow 字节相同，当前 checkout 内容不一致；未修改 Marketplace。故 PRD 最后一项验收门槛未满足，须由 Marketplace owner 对齐或给出可接受的源/镜像合同后再复验。 |

本轮关键源码复核还修正了实施计划开头残留的 `planning` 状态和设计中“execution or reviewer”
槽位表述；现分别准确反映当前执行状态及“一个逻辑槽最多一个 Teammate 执行”。
当前 CLI Channel 回归 14 files、129 passed，另 `channel.test.ts` 20 passed；正常
task/Channel 路径、旧命令兼容、模板生成归属均有对应测试。最近一次全量 CLI 测试发生
在仅更改父命令描述文字之前；描述变更后的 Channel 命令测试、模板完成环测试已重跑。

最终复验收据：Core lint/typecheck/build 均通过；CLI lint/typecheck/`basedpyright`/build
均通过（`basedpyright` 0 errors，68 warnings）；Core 全量 22 files / 404 passed / 1
skipped；CLI 全量 89 files / 2082 passed / 2 skipped / 1 failed；所有定向 Channel、
工件/profile/config/adapter、模板完成环测试通过。全量 CLI 的唯一失败和真实宿主 deferred
边界仍未解除；静态验收任务保持 `in_progress`，不代表生产宿主可用、Marketplace 已合并
或 v0.7.1 可发布。
