# 实施证据

- 复用已有 marker、symlink、update/uninstall 安全合同；修复 init 追加生成块时裁掉既有正文尾部空白的问题。集成 fixture 同时包含手工正文及 CodeGraph 块，验证其字节保持和 Trellis 块唯一性。
- CLI 全量门禁：103 个测试文件、2,281 项通过、2 项跳过；typecheck、lint、build 均通过。首次 lint 发现既有未使用的 `TDD_SHA256` 常量，删除该无调用常量后通过。
- 本修复需要进入安装版本，按原生 release 流程准备 `0.7.0-beta.50` manifest 和中英文发布说明；docs-site 只增加本次发布说明，不迁移其 AGENTS 或工作流。
- 源提交、CI 双包发布、安装与项目落点的实际结果待续记。GitNexus 在当前主机未找到原生入口，本轮不接管其项目特定生成块。
