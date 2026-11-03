# 实施计划：Trellis Teamwork 与业务阶段运行时改造

## 执行前条件

- 父任务与本 owner task 方案已获批准，本任务已按 Trellis 原生流程启动；后续依照以下步骤和适用检查推进。
- 在唯一 Trellis submodule checkout 中使用既有 `v0.7.1` 分支，以 `fa678d8bedd6ddc3891ad69706c79418a75bf147` 为任务基线；保留并沿该分支继续已有的 Teamwork 实现提交 `2af004be`、运行时修正 `70db2bf6` 和后续任务提交。不得新建分支或额外工作树。
- 开始代码修改前按 `trellis-before-dev` 读取 `.trellis/spec/core/backend/`、`.trellis/spec/cli/backend/`、`.trellis/spec/cli/unit-test/` 中适用的完整指导；核对 Core、CLI、模板与现有测试入口。

## 有序步骤

2026-11-03 当前增量按根父任务 `implement.md` 的 G1–G3 执行：先核对当前源码读取方与状态写入方，再实现规定层级的任务发现/解析、受控移动与显式迁移，接着同步所有宿主、模板、文档和 fixture，最后完成全量验证、打包及新项目冒烟。父任务 G4–G6 负责正式发布、真实安装、两个仓库现场迁移及根侧固定。当前增量合同位于根父任务 `design.md` 的“任务目录治理增量”；此前步骤 1–4 的既有实现保持，不重复改名或移除仍有作用的能力。

1. **完成 Teamwork 改名和资产收敛。** 先将 Channel 产品语义迁移至 Teamwork，覆盖 Core 模块/API、CLI 命令与注册、事件/字段、持久实例与存储、配置、模板、测试和文档链接。统一 `TeamworkSession`、`TeammateAssignment`、`general`/`advisor`/`committee`；收敛为四份指定 references，并将仍适用的内容按职责迁移。保留无关 channel 概念与原生 `subagent`，删除过时 Teamwork 路径及合同。**此步骤是本 owner task 的首个产品源码改动。**
2. **实现 Core/CLI 业务阶段合同。** 由单一 Trellis 任务记录保存任务身份、阶段游标、路线、按需路线依赖准入、授权、接受及 revision；CLI 负责受控变更和 revision 校验。覆盖阶段进入、适用阶段选择、跳过与理由、前进、回流、用户等待、依赖阻断、实施 dispatch、交付接受、完成与取消；“目标探索与需求核对阶段”的用户确认绑定当前 `artifact_revision`，修订后旧确认失效。路线依赖准入关联当前实际选用的依赖、状态、证据引用和 `task_route_revision`；无外部依赖的路线不要求准入记录。保持字段和验证只满足父任务合同所需，不复制 Pennix Skills 或 Lifecycle 状态。
3. **接入各业务阶段 workflow、Skills 和 resolver。** 为各业务阶段分别提供对应的 bundled native workflow 与 Skill，表达各自专属活动、产物和转换条件；resolver 从当前任务与路线中选择适用入口，支持有依据的跳过、阻断和回流。主 workflow 默认仅使用 bundled native；移除 Marketplace nested submodule 及其默认来源、mirror、catalog 和发布依赖，保留 resolver 现有的显式 custom workflow source 路径。接入 Teamwork 现有运行时、Hook 上下文、委派工作树主代理角色源及 `.trellis/scripts/task.py delegate-start <child-task>`。该入口校验父任务实施与测试验证阶段授权、子任务关系、当前路线依赖准入、子任务 `prd.md` 与 Git 基线，再调用 Paseo 原生 CLI 并把最小运行映射写入子任务；不新增通用规划器或额外的阶段状态机。
4. **完成 Trellis 内部验收并冻结协作接口。** 运行 Core/CLI 构建、测试、lint、typecheck，检查模板复制与 native resolver；验证 revision 失效、“目标探索与需求核对阶段”的用户确认、阶段接受、路线依赖准入、受控委派的拒绝前置条件与 Paseo 调用、Git 基线核验、运行映射留存，以及 Teamwork 派发/报告新鲜度和批次清理。确认默认 workflow 解析不依赖 Marketplace，显式 custom workflow source 仍可用，发布脚本不再依赖 Marketplace submodule。整理供 Pennix Skills 与 formal session handoff package 使用的稳定只读查询接口、失败码及受控 ownership 操作说明。记录测试结果、差异、风险和提交，作为父任务后续组合验收输入。

步骤依赖顺序为 1 → 2 → 3 → 4。若步骤 1 暴露既有 Teamwork 公开接口或数据合同与父任务已批准内容不符，暂停受影响改动并回到本任务方案审查；不得先继续阶段合同迁移。若步骤 2–3 暴露需要新增状态源、扩展权限或改变公开接口的要求，停止相关实现并申请父任务重新规划。

## 验证命令

按改动范围执行并记录结果：

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

另运行 Teamwork 改名涉及的针对性 Core/CLI 测试、模板复制检查、native workflow resolver 检查及 `git diff --check`；用 Paseo/Git stub 覆盖受控委派前置条件拒绝、worktree 基线核验、agent 启动参数和记录写入，以及未知启动结果的保留、重新授权后的安全复用、旧资源全部清除后的重建和活动/脏 worktree 阻断，不启动真实 agent；检查 `.gitmodules` 不再声明 Marketplace、默认 workflow 解析离线可用、显式 custom source 测试通过且 release staging 不排除或要求 Marketplace。测试定位和专用命令在实现前以当前 `package.json` 与测试脚本为准；不以本计划代替实际验收证据。

## 唯一停止点

完成步骤 4 并记录稳定协作接口、全部必要验证结果和剩余风险后，停止本 owner task，等待根任务接受 Trellis 组件证据。此处不执行发布、安装、根仓 gitlink 更新或 Pennix Skills/Lifecycle 实施。

## 回退

本任务源码始终在项目内 Trellis submodule checkout 的既有 `v0.7.1` 分支上修改。单项改动未通过验证时先保留证据并修复；若需改变已批准范围、状态合同或对外接口，停止并返回 Trellis 计划审查。只有局部改动无法在已批准合同内修复时，才回退该未集成改动；不得清理其他 checkout 内容或重写基线历史。
