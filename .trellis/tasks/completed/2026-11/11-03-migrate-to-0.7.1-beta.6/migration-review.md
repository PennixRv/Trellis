# beta.6 源码仓迁移核验

## 范围与确认

本任务由原生 updater 创建，用于核验源码仓现场迁移。用户已确认两仓迁移、四状态布局与完成月份，明确撤回三项历史任务，并要求源码保留既有 `v0.7.1` 分支后发布、重装和迁移。实现合同及执行证据继续由 `10-31-new-fork-workflow-trellis` 保存；本任务只采用目标核对与交付审查路线，不重复授予历史任务实施权限。

## 核验结果

- 正式发布源码为 `98d7381493661ec9a018407b62415a54af209828`，tag 为 `v0.7.1-beta.6`；[正式流水线](https://github.com/PennixRv/Trellis/actions/runs/41614110775) 成功，公共 npm 已核验 Core、CLI 及 beta 标签，CLI 精确依赖同版 Core。
- 经真实安装的 beta.6 CLI 原生更新，本仓 `.trellis/.version` 为 `0.7.1-beta.6`。保留既有包配置及自定义 ignore，没有创建分支或 worktree；docs-site 保留既有分支并已推送文档提交。
- 原生布局迁移处理 250 项旧任务、1,416 个文件；15 个机器引用文件按预期改写，其余文件哈希一致。十份历史 JSON 仅补漏引号，三项撤回任务有取消审查并由原生 cancel 收尾，没有执行旧业务动作。旧 `archive` 已移除，重复迁移预览为空。
- updater 新增本任务后共 251 项：planning 2、in_progress 15、completed 231、cancelled 3。本任务完成后进入 `completed/2026-11`，其他状态保持。
- 当前 owner task 位于 `in_progress/10-31-new-fork-workflow-trellis`，阶段仍为 `task_implementation`、路线 revision 为 1，原生 validate 通过。全状态原生 list 可读；模板与源码现场脚本一致。
- Core 403 项、CLI 2130 项通过，分别跳过 1、2 项；发布 CI 的类型检查、构建、完整测试及打包检查通过，根完整组合回归 19/19 通过，独立 handoff 测试另行通过。Python 检查为 0 错误、72 条警告；GitNexus 索引和输出限制见 owner execution，不将其描述为完整图覆盖。

## 收尾边界

本任务没有子任务或受托执行资源。完成仅表示本仓 beta.6 迁移已验收，不关闭长期 owner task，不执行原先暂缓的 Paseo 现场操作，不改写历史会话交接包。
