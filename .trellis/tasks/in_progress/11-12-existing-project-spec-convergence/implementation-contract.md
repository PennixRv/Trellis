# Trellis 实施合同

复用根任务 `.trellis/tasks/in_progress/11-12-existing-project-spec-convergence/implementation-contract-v2.md` 的 W1、W4 和验收覆盖，不构造第二份方案。根位于本仓库父目录；用户原文“直接完整推进，包括发布部署和重装”，已明确接受并授权同一候选的实现、验证、发布部署和项目资产更新。根侧 `implementation-approval.md` 保存完整授权边界。

本仓库分支 `fix/existing-project-spec-convergence`，实施前提交 `e16b5bff97ca304568119178fb5441ee664b5cd6`。当前主会话直接实施，不使用子代理或委派执行。修改命令和共享 spec 准备来源、bundled 方法及必要回归，发布交给现有 CI。GitNexus 索引落后 63 提交，handleReinit 的上游是 init 和 CLI；writeSpecIndex 无索引，已通过当前源码核对全部调用点，不能把空图当无影响。

## 验收覆盖

| 接受条件 | 工作包 | Owner | 验证入口 | 交付证据 | 停止条件 |
| --- | --- | --- | --- | --- | --- |
| 通用入口补齐且真实内容保全 | W1 | Trellis | init、writer、registry 回归 | validation.md | 覆盖、越界或旧前态失败 |
| 方法与发布身份一致 | W1、W4 | Trellis | 构建、完整测试、release preflight、根组合 | validation.md、根任务 | 必需检查失败或固定身份失配 |
