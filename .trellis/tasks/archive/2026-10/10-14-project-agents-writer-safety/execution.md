# 实施证据

- 复用已有 marker、symlink、update/uninstall 安全合同；修复 init 追加生成块时裁掉既有正文尾部空白的问题。集成 fixture 同时包含手工正文及 CodeGraph 块，验证其字节保持和 Trellis 块唯一性。
- CLI 全量门禁：103 个测试文件、2,281 项通过、2 项跳过；typecheck、lint、build 均通过。首次 lint 发现既有未使用的 `TDD_SHA256` 常量，删除该无调用常量后通过。
- 本修复需要进入安装版本，按原生 release 流程准备 `0.7.0-beta.50` manifest 和中英文发布说明；docs-site 只增加本次发布说明，不迁移其 AGENTS 或工作流。
- 源提交、CI 双包发布、安装与项目落点的实际结果待续记。GitNexus 在当前主机未找到原生入口，本轮不接管其项目特定生成块。

## 最终发布与项目落点

- 源码最终提交为 `e8e06047ce46babb3a4716531f444fd45fe7a3d3`，tag 为 `v0.7.0-beta.50`；docs-site 发布说明提交为 `e59c0d7cce788eada56f8f4367f501f3f206fa2a`。Trellis CI run `38532685061` 在 registry propagation 重试后成功，`@pennixrv/trellis` 与 `@pennixrv/trellis-core` 的 `0.7.0-beta.50` 均已可安装。
- 最终本地门禁为 103 个测试文件、2,281 项通过、2 项跳过；typecheck、lint、build 均通过。根项目已由原生 CLI 更新到 `0.7.0-beta.50`，最终 dry-run 报告无待更新资产。既有手工正文、CodeGraph 块和 Trellis managed block 的尾部空白保持测试通过。
- 本轮只修复 Trellis 原生 managed block 追加合同，不接管 GitNexus 或 docs-site 的项目规则生成；GitNexus 当前主机没有可用原生入口，按方案记录为未纳入首轮。
