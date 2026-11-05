# 工作流返工与任务重开实施补充

本补充承接根任务 `10-29-new-fork-workflow-master-plan-v2` 及 Lifecycle 子任务的 `workflow-return-and-reacceptance-optimization-proposal.md`。用户已选择 D-WF-RETURN-01/02/03、D-WF-LIFECYCLE-01/02 的 A 路线，并明确授权完整实现、验证、发布新版本与重装；不重复索取授权。源码目标为 Trellis fork，部署继续使用 Pennix 原生入口，不调用 Teamwork teammate。

## 实施合同

- 工作流层：现有 `phase return` 默认保留合同变更的失效行为；显式 `execution_rework` 只允许重入实施或交付，核验不变的需求、合同、路线、有效授权和已声明依赖准入，保留授权并撤销受影响接受事实。当前活动阶段的普通修复无需回流。
- 合同覆盖：新接受或授权的实施合同须有固定 `## 验收覆盖` 表。CLI 负责非空结构，方案 Skill 负责逐条语义覆盖；不自动废除已有授权。
- 生命周期层：独立 `reopen` 要求终态、原因和证据，将同一任务恢复到 `planning`，保留终态与取消事实和追加恢复历史，清理旧运行态、授权与准入。工作流阶段不自动回退，随后另行 `phase return`；重新授权后才能 `start` 进入 `in_progress`。
- 复用现有目录迁移事务、会话及 continuity 清理接口，不改共享迁移实现，不增加生命周期状态、依赖或独立恢复服务。源码、bundled workflow、阶段 Skills、SDK 字段及测试同步；发布 CLI/Core 同版本 beta.17，更新根仓及源码仓受管资产。

## 验收覆盖

| 接受条件 | 工作包 | Owner | 验证入口 | 交付证据 | 停止条件 |
| --- | --- | --- | --- | --- | --- |
| 合同内返工保留授权，合同变化仍需重授 | CLI 与 Core 字段和校验 | Trellis | task-workflow.integration、Core phase tests | 测试结果与 execution.md | 需求、合同或依赖失效 |
| 实施前发现接受条件覆盖遗漏 | CLI 结构门禁与方案 Skill | Trellis | 覆盖表缺失、空行及有效表回归 | 测试结果 | 表结构或语义覆盖不完整 |
| completed/cancelled 可受控重开并隔离旧授权 | reopen 与运行态清理 | Trellis | 两终态、旧运行态、目录、重新授权和 start 回归 | 测试结果 | 活动委派资源或清理失败 |
| 所有分发路径采用一致实现 | bundled workflow 与 Skills | Trellis | 模板、布局、全量测试、build、lint、typecheck、Python 静态检查 | 源码提交与发布记录 | 必需检查失败 |
| 新版本发布并真实重装与项目更新 | 发布及组合验收 | Trellis / 根仓 | npm 双包、Pennix update/check、原生 Trellis update | 安装版本和哈希 | 版本不一致或更新冲突 |

## 影响与失败恢复

任务 identity、终态历史与取消原因保留。`phase return` 仍拒绝终态，`reopen` 不提供直接进入 `in_progress` 的路径。新的覆盖表门禁在新接受和授权时生效；既有有效授权无需补批。依赖未就绪时拒绝快捷返工，要求核验事实；不因局部实现细节变化回退整个方案。新公开 beta 不覆盖已发布版本；安装及项目更新遵循原生回滚和冲突处理。
