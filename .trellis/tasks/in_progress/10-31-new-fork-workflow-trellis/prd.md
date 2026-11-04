# 新 fork 工作流：Trellis Teamwork 与业务阶段运行时改造

## 2026-11-04：Teamwork 完整配置与执行修复

承接根父任务 `10-29-new-fork-workflow-master-plan-v2` 的 T-01–T-08、设计 3.4.1–3.4.12 与 U1–U8。用户已审查补充方案，并明确授权形成完整修复优化方案后直接实施，无须二次决策。本轮源码基线为 `v0.7.1@9ad095cfa58010441a1f56e81d956d5695315b41`，只在现有 submodule checkout 修改，不建分支或 worktree。

- 六项专业 profile 为 architecture、review、research、verification、exploration、diagnosis，各有精确角色卡。新版项目 profile JSON 持有卡片引用、明确默认与三套候选；六项默认 Codex Sol，第二套 Copilot Sol，第三套为对应 Copilot Opus/Sonnet；architecture 使用 xhigh，其余 high，不使用 Luna。
- 模式默认及可调整参数写入版本化 `.trellis/teamwork.json`，既有并发/guard 留在 config.yaml；本次计划保存模式、成员选择/覆盖、选型理由与不可变 execution。参数来自配置文件，不在代码/Skill 维护第二份运行默认。
- 共同/专业指令与 brief 分离、摘要并冻结，启动/继续/重试不读可变 profile 重新选型。公开成员字段移除固定 role_id，普通 lens 可省略，committee 按既定语义保持互异关注点。保留通用交互 agent loader。
- 完整接通 Codex/Claude/Copilot/DSH adapter、模型/思考参数、supervisor、交互与 batch coordinator、只读预检、失败/取消/恢复和报告核验；原生 CLI 与 ACP 边界如实披露。角色只读是行为合同，不新增权限隔离；与 Paseo 完全正交。
- 上下文使用默认，不新增窗口、token 预算或输出预留机制。模板枚举、六卡与配置、全平台 Skill/四 references、meta/阶段指导、测试/spec/公开文档须同步。四后端协议/fixture 验证，Codex/Copilot 真实任务验证，Claude/DSH not_run；当前元数据成功不是实现验收。
- 修复前核对所有调用者及失效路径；配置变化影响后续新计划，已经冻结的批次不变。原生 init/update、构建/打包和必要质量检查通过才向根父任务交付。发布重装、两仓现场迁移和备份清理由根父任务负责；旧任务与一次性交接包不改。

详细设计与恢复边界以本 owner 的设计/实施增量及根父任务上述章节为准；本增量不重做已经交付的无关任务治理和阶段实现。

## Goal

在 Trellis fork 中按父任务已批准的范围，先完成既有 Teamwork 产品与资产改名，再实现业务阶段、路线、授权和阶段接受的 Core/CLI 合同，以及各业务阶段对应的 bundled native workflow、Skill 和 resolver。完成 Trellis 仓内验证后，为 Pennix Skills 和根侧验收提供稳定接口与验证证据。

## Requirements

- 2026-11-03 增量：按父任务 PRD 的 `native-task-lifecycle-expansion` 最新决定和父任务 `design.md` 的“任务目录治理增量”，完整实现 planning/in_progress/completed/YYYY-MM/cancelled 目录治理、生命周期受控移动和显式可预览迁移。目录不增加状态，保留任务资料；运行记录仍按原门禁清除。源码在当前 `v0.7.1`，本增量基线为 `025395bf9639df8b8f7dcb231470d2a1378bb279`。
- 同步任务发现/解析、父子关系、会话与 continuity/ownership、Teamwork、全部宿主资产、状态统计、测试、spec、workflow、Skills 与随附文档。新增完成任务按完成月份，旧 archive 已完成任务保留原月份。两个仓库现场均迁移；十份历史 JSON 仅修复语法，用户明确撤回的三项旧任务须先原生取消。发布、真实安装和两仓库迁移由根父任务执行，组件实现须提供其所需的安全入口与证据。

- owner task 起始基线为 `fa678d8bedd6ddc3891ad69706c79418a75bf147`；实施在根仓 `Trellis` submodule 的既有 `v0.7.1` checkout 中继续。保留从该基线延续的 Teamwork 提交链、当前任务改动及未跟踪 GitNexus Skill 资产，不新建分支或额外 Git worktree。
- 第一项产品源码变更必须先完成既有 Channel 产品到 Teamwork 的改名及已批准资产收敛：Core/API、CLI、事件与字段、存储、配置、模板、测试和文档保持同一 Teamwork 命名合同；公开命令根为 `trellis teamwork`，持久实例为 `TeamworkSession`，原子项为 `TeammateAssignment`，协作模式为 `general`、`advisor`、`committee`。
- 阶段状态、路线、revision、授权和接受事实只有 Trellis 任务记录及 Trellis CLI 可写。不得新增第二状态源或第二状态机；阶段可以按任务需要选择、跳过或回流，跳过和回流保留当前合同要求的理由及证据。
- Trellis fork 的主 workflow 只使用 bundled native source；移除 Marketplace nested submodule 及其作为 workflow 默认来源、mirror、catalog 和发布依赖的路径。保留仅由用户明确指定的 custom workflow source，作为独立扩展路径；不修改独立 Marketplace 仓库，也不移除通用的 registry-backed spec-template 能力。
- “目标探索与需求核对阶段”的需求基线须经用户明确确认，并绑定当前 `artifact_revision`；未确认、要求修订或 revision 过期时不得接受该阶段或进入“决策空间构造与归并阶段”。
- 各业务阶段分别保留其职责、入口和对应 Skill。resolver 按当前任务及路线选择适用阶段，不合并各阶段流程，也不强制每项任务经过全部阶段。
- Teamwork 派发与报告核验使用当前任务的 `current_phase_id`、`task_route_revision`、`input_revision` 及计划摘要；阶段接受由 Trellis CLI 校验当前 revision。批次结束后保留进入接受链的报告与证据，清除临时批次数据；不改变既有批次关闭门或 teammate 权限。
- 实施委派通过生成到项目的 `.trellis/scripts/task.py delegate-start <child-task>` 进入。父任务必须处于已授权的“任务实施与测试验证阶段”，且其当前 `route_dependency_admission` 为 `ready` 并覆盖本次选择的 Pennix Lifecycle、Paseo 和 Git；子任务必须与父任务双向关联，子任务 `prd.md` 是该子任务唯一的 `implementation_contract` 输入，并已提供目标分支和 Git 基线。准入或事实不匹配时不得创建 Paseo workspace 或启动 agent。该入口只启动并记录当前委派映射，不接受结果、不推进父任务阶段或任务状态。
- 不在本任务修改 Pennix Skills、Pennix Lifecycle、Paseo、用户安装目录或独立 Marketplace 仓库；不实现旧数据库迁移、兼容别名或未经验证的 host adapter。

## Acceptance Criteria

- [ ] 新布局的四状态、月份、解析与歧义拒绝、父子引用、ownership 和会话路径、终态清理、迁移预览/apply/幂等及失败恢复通过真实隔离仓库测试；活动文档、模板与宿主不存在相冲突的旧布局合同。旧目录只由显式迁移入口处理，不增加旧阶段兼容或 archive 状态/命令。

- [ ] Teamwork 产品面完成整体语义改名，已决的 Teamwork 对象、模式、公开命令及四份 references 一致；旧产品路径、链接和合同不再残留，无关 channel 语义和宿主原生 `subagent` 语义保留。
- [ ] Core/CLI 以单一任务记录实现业务阶段游标、路线及 revision、授权与接受校验；“目标探索与需求核对阶段”的用户确认门按当前 artifact revision 生效，阶段转换、跳过、回流、阻断、完成与取消的写入边界一致。
- [ ] 各业务阶段有对应的 bundled native workflow 与 Skill；resolver 能按当前任务和路线选取适用入口，并在阶段结果、路线或输入失效时拒绝过期接受；不要求无条件经过全部阶段。
- [ ] bundled native workflow 是主 workflow 的唯一默认来源；Trellis fork 不保留 Marketplace nested submodule、workflow mirror、catalog 或发布依赖，显式 custom workflow source 仍可用且不进入主 workflow 默认路由。
- [ ] Teamwork 的派发、报告新鲜度、接受链证据留存及临时数据清理符合上述合同，Teamwork Session 生命周期不受批次清理影响。
- [ ] 路线依赖准入只保存在当前任务路线并绑定当前 `task_route_revision`；受控委派核验父任务授权、子任务关系、当前准入、子任务 `prd.md` 摘要和 Git 基线后，才调用 Paseo 创建 worktree 并启动委派工作树主代理。启动结果写入子任务的窄化 `delegated_worktree_execution_record`；启动结果不明时记录为需核实并保留现场，不自动重试。后续再次启动须先确认旧代理已结束并重新授权；仅当映射仍匹配且 worktree 干净、基线未变时复用。若旧 workspace、worktree 与分支均已核实清除，可按新授权重建；映射不完整、现场有改动或无法核实则停止并保留现场。不自动接受阶段或完成任务。
- [ ] Trellis Core/CLI 构建、相关测试、lint 与 typecheck 通过；模板分发和 native resolver 验证通过；对外查询、错误码及 ownership 接口记录齐全，供后续 owner task 使用。
- [ ] 变更范围、验证结果、剩余风险及回退点记录在本任务；本 owner task 不发布、不安装、不固定根仓 gitlink。

## Notes

- 本任务覆盖父任务实施与测试验证阶段计划的步骤 1–4；复杂任务须在启动前提供 `design.md` 与 `implement.md`。
- Pennix Skills 与 Pennix Lifecycle 的源码和任务记录边界按父任务方案执行。
