# 0.7.2-beta.0 迁移检查

本任务由原生 update 自动生成，仅核对已获 owner 合同 `10-31-new-fork-workflow-trellis/research/fork-review-remediation.md` 授权的更新，不另行实施。

公共 npm 双包与 beta 标签已验证，latest 仍为 0.7.1；Pennix 精确更新成功。项目经原生 `update --create-new` 升至 0.7.2-beta.0。`.trellis/config.yaml.new` 会删除当前 CLI/Core/docs-site 包声明及 default_package，明确拒绝并保留原配置；`.trellis/.gitignore.new` 只增加 `.task-phase.lock`，接受并已合入。逐份精确删除处置完的 sidecar，不清理其他运行态或历史。

迁移说明已完整核对。当前 schema-2 角色/模式配置与原计划不需改写，未执行破坏性迁移；自动 PRD 中的 `--migrate` 是通用提示，并非本仓必须执行的迁移动作。spec/task/workspace/handoff 保留，仅主动修正原生连续性规范的一处 recover 例外表述。等待护栏、Skill、脚本和各已配置宿主模板由原生更新分发；长期主任务不因此完成，无新增运行资源。

交付依据：Core 423/CLI 2330 测试通过，两包 lint/typecheck/build、文档 lint、Python 检查、模板 parity 和 packed CLI 精确 Core 依赖通过。发布 CI 42063839317 第二次执行 success。剩余边界为宿主普通消息不受 Hook 强制及未运行所有真实 provider/非 Linux 宿主，见原审查逐项处置；不构成此迁移检查的待实施项。
