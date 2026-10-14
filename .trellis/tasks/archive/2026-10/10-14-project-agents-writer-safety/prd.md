# 项目 AGENTS 原生写入合同

核验根任务 `10-14-project-agents-governance-plan` revision 1 已批准的 Trellis 子范围，工作分支 `codex/project-agents-governance`，目标 package `cli`。

- 核验 init/update/uninstall、managed block、manifest/hash 和迁移的 AGENTS 合同。
- 正常唯一块可更新/删除；缺失、重复、逆序 marker 和 symlink 不安全场景拒绝并保留正文。
- 保留块外手工规则和 CodeGraph 块；重复运行幂等；override 警告不能冒充真实生效证明。
- 已有安全能力通过即可，不为制造差异重写。确有缺口才最小修复及回归测试。
- 对适用包运行原生质量门禁并记录实际提交/版本；不迁移本仓库自己的 GitNexus 或项目 AGENTS。
