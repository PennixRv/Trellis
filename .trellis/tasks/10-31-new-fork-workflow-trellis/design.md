# 设计：Trellis Teamwork 与业务阶段运行时改造

## 目标与边界

本设计落实父任务步骤 1–4，目标基线为 Trellis `fa678d8bedd6ddc3891ad69706c79418a75bf147`。产品源码、测试、模板和随附文档只在根仓 `Trellis` submodule 的既有 `v0.7.1` 分支 checkout 内修改，保留该分支上的 Teamwork 历史，不新建开发分支或额外 Git worktree。此约束只规定当前任务的源码落点；本设计中的实施委派仍按已批准的产品合同，通过 Paseo 创建和管理运行时 Git worktree。Pennix Skills 主线路由、Pennix Lifecycle、Paseo 和独立 Marketplace 仓库的变更不属于本任务。

## Workflow 来源边界

主 workflow 只从 Trellis fork 自带的 bundled native source 生成和更新。移除 `.gitmodules` 中的 Marketplace nested submodule，以及将 Marketplace 作为主 workflow 默认来源、mirror、catalog 或发布依赖的路径。resolver 保留现有显式 custom workflow source 能力，仅在用户指定 source 时解析自定义 workflow；该路径属于独立扩展，不进入当前主 workflow 的默认路由或发布集合，也不扩展其来源管理合同。通用 registry-backed spec-template 能力及独立 Marketplace 仓库不在此变更范围内。

## 组件职责与数据流

Trellis Core 定义可复用的任务记录、阶段与路线数据结构及其校验；Trellis CLI 是这些持久事实的唯一写入和接受入口；bundled native workflow、各业务阶段对应的 Skill 与 resolver 将当前任务事实投影为阶段内操作指引。Pennix Skills 后续更新其路由与决策协助，通过稳定查询接口读取 Trellis 状态，不另建阶段或任务状态。

任务记录保存任务身份、适用阶段、当前阶段、路线及 `task_route_revision`、按需记录的路线依赖准入、阶段输入和结果 revision、授权及接受事实。阶段 workflow 说明本阶段活动、用户交互、产物和转换条件；阶段是否适用由任务路线决定，跳过或回流有记录依据，不把不同阶段的内部流程合并成通用流程。

“目标探索与需求核对阶段”的基线在用户确认前不构成已接受需求；确认绑定当前 `artifact_revision`。输入、目标或范围修订使旧确认失效。“决策空间构造与归并阶段”“解决方案设计与收敛阶段”“任务实施与测试验证阶段”和“交付审查与现场收尾阶段”分别按各自职责形成决策空间、收敛方案、实施和交付审查结果，Trellis CLI 只在当前 revision 与所需证据有效时接受结果并写入阶段转换。

Teamwork 作为任务内协作能力读取当前阶段、路线与输入 revision，并将这些事实及计划摘要绑定到派发和报告核验。Teamwork 不写入 Trellis 阶段或接受状态。被主线接受链引用的报告与证据保留为任务产物；批次临时数据在批次结束后清理，Teamwork Session 按自身生命周期管理。

## 实施委派入口

路线依赖准入保存在 `task_workflow.route_dependency_admission`，只描述当前任务路线实际选用的依赖、`admission_state`、`evidence_refs` 和绑定的 `task_route_revision`。`task.py phase admission` 通过现有 Trellis CLI 写入；路线变化、阶段回流或当前阶段产物变化会清除此准入结果。没有外部依赖的路线无需创建准入记录。

`.trellis/scripts/task.py delegate-start <child-task>` 是唯一实施委派启动入口。它通过任务已有的双向 parent/children 关系定位父任务，核验父任务当前处于已授权的“任务实施与测试验证阶段”，并检查当前准入为 `ready`、revision 匹配且覆盖本次使用的 Pennix Lifecycle、Paseo 和 Git。子任务 `prd.md` 作为唯一实施输入；入口读取其当前摘要，并使用子任务已有的 `branch` 与 `base_branch` 作为目标分支和基线。它不新增 brief、调度器或派发状态机。

通过准入后，入口核验 Paseo CLI 与 daemon 可用，使用 Paseo 原生 workspace 和 run 命令创建隔离的 Git worktree、验证实际分支与基线，再把委派工作树主代理角色和子任务 `prd.md` 派生为 `initialPrompt`。子任务当前 `delegated_worktree_execution_record` 保存 workspace、worktree、agent、分支、基线和合同摘要映射；启动结果不明时标为需核实并保留现状，不自动重试。再次启动要求有新的实施授权，并确认旧代理已结束；仅复用身份匹配、干净且仍处于原基线的 workspace/worktree。若旧 workspace、worktree 和分支均已核实清除，可按新授权重建；所需映射缺失、agent 状态无法核实、资源仍在或现场内容有变化时停止并保留现场。`TASK_DELEGATE_REAUTHORIZATION_REQUIRED` 表示重试尚无新的实施授权；`TASK_DELEGATE_RECONCILIATION_REQUIRED` 表示旧 agent 或资源映射尚不能核实。该记录不接受实施结果，实施验证、Git 集成、结果接受和资源清理由现有任务实施与测试验证阶段与交付审查流程核验。

## Teamwork 改名与资产合同

步骤 1 先把既有 Channel 产品概念改为 Teamwork，覆盖 `packages/core/src/channel/` 及其导出和调用方、`packages/cli/src/commands/channel/` 及命令注册、事件/字段、存储、配置、测试、bundled Skill 和全部相对链接。仅迁移 Teamwork 专属语义；保留真实 channel 基础设施概念以及宿主原生 `subagent` 用法。

Teamwork Skill 仅分发 `teamwork-plan-construction.md`、`teammate-configuration-matrix.md`、`coordination-modes.md` 和 `teammate-processes.md` 四份 references。将仍适用的旧 reference 内容按职责合并到这四份文件或 Skill 正文，删除过时合同；不保留旧路径、旧 API alias 或旧数据读取/迁移。

计划构造绑定当前 task/phase/route/input revision 和计划摘要。派发和报告核验检查绑定事实是否仍有效；接受仍由 Trellis CLI 校验。不得改变现有批次关闭门、扩展 teammate 权限或增加第二状态机。

## 失败与回退

所有改动位于根仓 `Trellis` submodule 的既有分支与 checkout；尚未进入根仓发布或安装。局部验证失败时在当前 owner task 中修复并重验。若发现父任务合同、公开接口或影响范围需要改变，停止依赖步骤，记录事实并回到计划审查；若某组改名遗漏导致合同不一致，按受影响路径修正或在尚未集成时恢复该组改动。不得用兼容层掩盖错误命名，也不得执行数据迁移。
