# 新 fork 工作流：Trellis Teamwork 与五阶段运行时改造

## Goal

在 Trellis fork 中按父任务已批准的范围，先完成既有 Teamwork 产品与资产改名，再实现任务阶段、路线、授权和阶段接受的 Core/CLI 合同，以及五个相互区分的 bundled native workflow、阶段 Skill 和 resolver。完成 Trellis 仓内验证后，为 Pennix Skills 和根侧验收提供稳定接口与验证证据。

## Requirements

- 目标基线为 `fa678d8bedd6ddc3891ad69706c79418a75bf147`，集成目标分支为 `pennix/new-fork-workflow`；产品源码只在本 Trellis worktree 修改。
- 第一项产品源码变更必须先完成既有 Channel 产品到 Teamwork 的改名及已批准资产收敛：Core/API、CLI、事件与字段、存储、配置、模板、测试和文档保持同一 Teamwork 命名合同；公开命令根为 `trellis teamwork`，持久实例为 `TeamworkSession`，原子项为 `TeammateAssignment`，协作模式为 `general`、`advisor`、`committee`。
- 阶段状态、路线、revision、授权和接受事实只有 Trellis 任务记录及 Trellis CLI 可写。不得新增第二状态源或第二状态机；阶段可以按任务需要选择、跳过或回流，跳过和回流保留当前合同要求的理由及证据。
- Trellis fork 的主 workflow 只使用 bundled native source；移除 Marketplace nested submodule 及其作为 workflow 默认来源、mirror、catalog 和发布依赖的路径。保留仅由用户明确指定的 custom workflow source，作为独立扩展路径；不修改独立 Marketplace 仓库，也不移除通用的 registry-backed spec-template 能力。
- 阶段 1 的需求基线须经用户明确确认，并绑定当前 `artifact_revision`；未确认、要求修订或 revision 过期时不得接受阶段 1 或推进到阶段 2。
- 五个阶段各自保留其职责、入口和阶段 Skill。resolver 按当前任务及路线选择适用阶段，不把五阶段压成一个统一阶段模型，也不强制每项任务经过全部阶段。
- Teamwork 派发与报告核验使用当前任务的 `current_phase_id`、`task_route_revision`、`input_revision` 及计划摘要；阶段接受由 Trellis CLI 校验当前 revision。批次结束后保留进入接受链的报告与证据，清除临时批次数据；不改变既有批次关闭门或 teammate 权限。
- 不在本任务修改 Pennix Skills、Pennix Lifecycle、Paseo、用户安装目录或独立 Marketplace 仓库；不实现旧数据库迁移、兼容别名或未经验证的 host adapter。

## Acceptance Criteria

- [ ] Teamwork 产品面完成整体语义改名，已决的 Teamwork 对象、模式、公开命令及四份 references 一致；旧产品路径、链接和合同不再残留，无关 channel 语义和宿主原生 `subagent` 语义保留。
- [ ] Core/CLI 以单一任务记录实现阶段游标、路线及 revision、授权与接受校验；阶段 1 用户确认门按当前 artifact revision 生效，阶段转换、跳过、回流、阻断、完成与取消的写入边界一致。
- [ ] 五个阶段有各自对应的 bundled native workflow 与 Skill；resolver 能按当前任务和路线选取适用入口，并在阶段结果、路线或输入失效时拒绝过期接受；不要求无条件经过全部阶段。
- [ ] bundled native workflow 是主 workflow 的唯一默认来源；Trellis fork 不保留 Marketplace nested submodule、workflow mirror、catalog 或发布依赖，显式 custom workflow source 仍可用且不进入主 workflow 默认路由。
- [ ] Teamwork 的派发、报告新鲜度、接受链证据留存及临时数据清理符合上述合同，Teamwork Session 生命周期不受批次清理影响。
- [ ] Trellis Core/CLI 构建、相关测试、lint 与 typecheck 通过；模板分发和 native resolver 验证通过；对外查询、错误码及 ownership 接口记录齐全，供后续 owner task 使用。
- [ ] 变更范围、验证结果、剩余风险及回退点记录在本任务；本 owner task 不发布、不安装、不固定根仓 gitlink。

## Notes

- 本任务覆盖父任务实施计划的步骤 1–4；复杂任务须在启动前提供 `design.md` 与 `implement.md`。
- Pennix Skills 与 Pennix Lifecycle 的源码和任务记录边界按父任务方案执行。
