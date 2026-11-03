# Migration Task: Upgrade to v0.7.1-beta.6

**Created**: 2026-11-03
**From Version**: 0.7.1-beta.5
**To Version**: 0.7.1-beta.6
**Assignee**: penn

## Status

- [x] Review migration guide
- [x] Update custom files
- [x] Run `trellis update --migrate`
- [x] Test workflows

---

## v0.7.1-beta.6 Migration Guide

## 任务目录迁移

先运行 trellis update --migrate 更新脚本与工作流，并审查自定义文件冲突。更新模板不会自动移动任务。随后运行 python3 .trellis/scripts/task.py migrate-layout 预览，确认后运行 python3 .trellis/scripts/task.py migrate-layout --apply。planning、in_progress、cancelled 任务进入同名子目录；completed 任务进入 completed/YYYY-MM，旧 archive 的月份保持不变。task.json.status 是唯一状态事实，迁移不授予历史任务实施权限，也不重写历史正文或交接包。

无效 JSON、重名、未关闭的委派资源、待交接所有权或不安全路径会阻止整个迁移。先处理明确的输入问题，再重新预览。发生中断时运行 python3 .trellis/scripts/task.py migrate-layout --recover，核验后重新预览；不要手工移动目录或删除事务记录。迁移会同步改写机器引用和当前会话指针；若连续性摘要变化，按原生 phase 接纳和 transfer reconcile 流程重新收敛当前所有权，保留历史交接摘要。

### AI Assistant Instructions

When helping with this migration:

完整检查迁移预览、四种状态及月份分布、任务数量、父子关系和当前会话路径。只修复有证据的历史输入错误，不把 archive 中未完成任务伪造为 completed。使用原生生命周期入口完成或取消任务，不手写运行状态。保护项目配置、历史正文、二进制附件和不可变交接包。迁移后再次预览应为空，并运行 task.py list、current、phase show 和项目检查验证现场。

