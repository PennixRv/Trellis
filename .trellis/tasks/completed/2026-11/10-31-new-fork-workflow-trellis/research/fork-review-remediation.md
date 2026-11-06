# fork 全面审查整改实施合同

本 owner task 承接根协调任务 `10-29-new-fork-workflow-master-plan-v2` 的 `research/fork-review-remediation.md`，审查分析与四项用户决定以该任务的 `research/fork-review-20261105/review-findings.md` 和 `codex-paseo-wait-investigation.md` 为依据；不修改已交付 beta.19 的旧合同。

## 授权和边界

用户授权核实全部发现、完成必要 Grill 后实施、提交推送、发布重装。已确定：全部 attempt 报告/worklog 保留到显式原生清理；新版本保持 beta 且高于 stable 0.7.1；退出隐式 Marketplace spec 来源，保留显式 registry，以索引/指南和真实源码 bootstrap 建立规范；等待采用 CLI 状态投影、支持工具的 Hook 围栏、Skill 静默续接及隔离验证，不修改 Codex/Paseo 服务端，不承诺 Hook 阻止模型唤醒。

主工作树主代理负责源码实施；Teamwork 只读。源码、测试、bundled 模板、生成资产、manifest 和规范在本仓闭合；文档站在其独立 submodule 闭合；根仓仅保存协调和组合验收。旧审查批次不重开，失败续做保留关联且不重派成功项。所有候选先验证真实性，被有效后续设计替代或无法复现者写明排除依据，不能盲改。

## 工作包

1. B-F1–F9、B-H1–H4、R1/R2：全部尝试证据留存；实际成员容量；冻结配置、信任根、零预算、错误诊断；基于可核验证据的恢复；显式关联的失败子集续做；CLI 独占 FIFO/监控/重试/结算，Hook 使用同一原生状态并允许取消和诊断，Skill 静默续接原句柄。
2. A-F1/F2、C1–C7、C-H1–H5：生命周期回流、取消、结构化错误与活动指针；父子解绑锁与资源门禁；委派失败恢复、稳定身份、不可变合同/角色/结果路径绑定、真实健康检查、职责边界及所有权竞态。未知资源不因 PID 消失或超时被接管。
3. D1–D5、E1–E5、E-H1–H3：多宿主阶段/配置读取与错误处理；重复提示源归并；受管理目录和单文件备份；跨状态 bootstrap 识别；离线默认 spec 初始化与显式 registry；基于实际源码 bootstrap 和适用规范读取；暂态发布校验重试及真实升级提示。保留用户自定义规范，不强制英文或不相关占位内容。
4. 同步调用者、测试、fixture、导出、Skill、manifest 与文档；先专项再适用全量检查，逐项回写最终处置。CLI/Core 锁步发布下一未占用且高于 0.7.1 的 beta（候选 0.7.2-beta.0），经 CI 和 npm 核验后由 Pennix 重装，再原生更新两仓及集成验收。

保持当前架构，无新增依赖或第二份状态机。范围内局部实现和测试补充不重复请求批准；涉及新实质取舍才暂停相应工作包。先闭合证据与容量，再恢复/状态投影，生命周期和初始化可独立修复，最后统一分发验收。

## 验收覆盖

| 接受条件 | 工作包 | Owner | 验证入口 | 交付证据 | 停止条件 |
| --- | --- | --- | --- | --- | --- |
| 所有尝试保留、容量准确、失败子集续做关联 | Teamwork | Trellis | coordinator/batch/guard/结果集成回归 | 发现项和测试结果 | 未知运行状态不得释放或重派 |
| CLI 控制 FIFO，Hook/Skill 正确续接 | Teamwork | Trellis | 隔离宿主 Hook 与嵌套工具、取消/诊断 fixture | 状态投影与动作围栏证据 | 不支持的约束不宣称强制生效 |
| 生命周期、委派和所有权正确且资源可追踪 | 生命周期与委派 | Trellis | 原生 Python/CLI、故障及并发测试 | 复现、摘要和回归 | 身份不明或持续写入保持围栏 |
| 初始化、备份、多宿主资产不损坏用户内容 | 分发和初始化 | Trellis | init/update/restore、模板/打包集成 | 离线、跨状态及恢复往返结果 | 自定义内容冲突停止覆盖 |
| 全部发现有处置，源码/分发/安装一致 | 集成发布 | Trellis/根仓 | 图影响、lint/typecheck/test/build、CI、Pennix | 提交、版本及组合验收 | 必需检查未通过不发布 |

运行日志和临时状态不提交。该工作包完成不等于主任务整体关闭。

## 2026-11-06：第二轮并行审查增量

本增量承接根协调任务 `research/fork-review-20261106-round2/teamwork-process-findings.md` 与 `teammate-findings-summary.md`。根侧逐项裁定、证据来源、排除项和跨仓目标映射以这两份文档为准；本合同只收录 Trellis 仓负责的源码、测试、bundled 资产和文档工作。不得重派已成功的旧审查项，不调用 Teamwork teammate 实施。

已确认的决定：

- Teamwork 中 teammate 只提交结论、证据、限制和阻塞；attempt 结束、报告提交、协议校验与主代理接受是不同事实。CLI 独占 FIFO、后台监控、重试和整批回收；主代理在前台等待整批结束，再统一核验并写入 disposition。不得逐个暂停并要求主代理驱动队列，也不得把 teammate 自报 `complete` 映射为主代理接受。
- consumed owner 可在用户明确授权后显式转移。转移前核验当前任务现场与连续性；成功后增加 generation 并 fencing 旧 session。任何关键现场未知时拒绝转移，不释放旧 owner。
- `implementation`/`combined` 路线不能跳过实施阶段后仍在 `planning` 完成。即使最终无需源码改动，也须进入实施生命周期并以当前状态满足接受条件的证据完成；若确认没有实施工作，应先通过原生路线/分类入口收敛为 `analysis`。
- ACP 后端可将角色与 brief 放在同一个 ACP 用户消息中，但必须保持结构化字段边界，不得声称它们具有 system/developer 消息优先级。
- 输入规模按父任务已接受的 T-07 执行：不新增 token/window 配置或自动截断；只保留合同要求的大小边界，并准确区分已内联内容、可按需读取的引用和不可用内容。
- 进程出生身份无法读取时，自动恢复继续 fail closed；只有通过 Teamwork 原生、可审计的显式确认入口才能释放对应租约。确认必须写入持久 reconciliation disposition；不得把 EPERM 或身份未知当作进程已退出。
- 发布预提交必须按暂存区相对 HEAD 的差异判断是否提交；开始 release 前发现已暂存的 `.trellis/` 或 `docs-site/` 变化，应明确阻断且不重置用户 index，避免排除路径改动被空提交逻辑误判或被无路径限制的 commit 带入。

实施前先按根侧发现表核实来源与调用链。根侧发现中属于 Pennix Skills、docs-site 或其他组件维护源的条目，由对应 owner 闭合；不得在 Trellis 消费副本中制造第二份权威文本。B17 已有脱敏 Bearer 占位文本反例并作窄修复；E13、E14 等未证实项必须先复现或明确撤回，不能作为既定缺陷修复。其余已确认的 Trellis 项按 A/B/C/D 分组落实；发布脚本 E7 由本仓 owner 修复，跨仓正式发布、安装与组合验收仍由根协调任务执行。

本增量验收要求：

| 范围 | 接受条件 | 必要验证 |
| --- | --- | --- |
| A：任务生命周期与阶段准入 | 路线依赖、受保护元数据、终态 start、明确撤回、实施阶段必经、reopen 文案和 skip revision 均符合根侧裁定 | 对应 CLI/Core 状态矩阵与真实生命周期往返测试；不手写终态夹具替代原生流程 |
| B：Teamwork 运行时与回执 | 报告提交不等于接受；主代理 disposition 在整批返回后作出；成员级产物错误与批次级运行态不确定分离；FIFO、后台监控、前台阻塞、恢复与证据保留闭合 | coordinator、batch、guard、provider adapter 的正常/失败/崩溃隔离测试；Codex/Copilot 真实宿主路径按根任务授权验证 |
| C：连续性、所有权与委派 | 中间态恢复有唯一 owner 和幂等动作；workspace 创建可恢复；受保护变更完整核对；consumed owner 转移按已决授权、现场、generation 与 fencing 规则执行 | 逐状态故障注入、重复调用、并发竞争及旧 owner 写入拒绝测试 |
| D：跨宿主与资产 | 坏状态 fail closed；Hook、Skill、ACP payload、配置与文档表达同一合同；规范和生成副本以维护源为准 | 多宿主同 fixture、ACP 序列化 fixture、生成/分发 parity 与链接检查 |
| 根侧跨仓项 | docs-site、Pennix Skills 及根侧职责项各由真实 owner 处理，未证实项有可复现证据或书面排除理由 | 根协调任务收集 owner 提交、版本、安装和组合验收证据 |

任一项若需要改变用户已确认的范围、职责、权限、安全边界或发布/验收路径，先暂停该工作包并回根协调任务处理；同范围局部实现选择按现有合同直接推进。实施和验证通过后，逐项回写两份根侧发现表的最终处置，再执行本 owner 原生交付流程。
