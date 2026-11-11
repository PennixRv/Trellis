# 彻底移除旧原生子代理分发体系

根任务为 codex-workflow-optimization 的 `11-11-codex-native-subagent-policy-violations`，已确认需求和彻底移除决定；实施合同 revision 为 `38887415dca32b1ba6746a4402d05b8840c7a8d0dd566b9ff8a7aa4bcc3a201d`。2026-11-11 用户明确批准组件源码、测试、必要文档、本地组合验证及按前序方式发布部署重装。本组件记录该授权，不重复向用户申请。

目标：删除旧宿主原生子代理模式、角色、工具、注入、生成和当前指引；现有项目通过原生入口清理，迁移和恢复不得重新建立旧体系。保留 Task CLI、主会话能力、只读 Teamwork、已授权 Paseo、spec、身份和显式上下文数据。无兼容开关、旧别名或旧执行器。遇未知用户内容保全并停止，不以残留活跃入口宣称完成。

修改范围为 CLI 源码、模板、测试、对应原生规范及 docs-site 当前文档；core 和 adapter 协议保持，仅沿现有一致版本发布合同处理。主会话直接实施和审查，不启动代理、不使用 Copilot。

源码基线 `4ccff411`；目标分支 `fix/remove-native-agent-dispatch`。完整方案与跨组件接受条件由根任务 design.md 拥有，组件实施和验证在 execution.md 记录。
