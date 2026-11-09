# W1 执行证据

当前主会话直接实现控制面、可选公开 SDK 包、固定角色、共享节点方法、协作 Skill 和 Codex Hook。固定角色保留原生资产 frontmatter，SDK 只发送同版固定正文；任务、attempt、许可与合同保持在按次只读投影中。无 Trellis 目标不自动初始化。

当前原生控制面测试覆盖独立 Git 工作树、冻结输入、包含性、真实 commits/paths、未知创建接回且不重放、未知发送需要证据、merge/FF ancestry 与保全核销。v1 runtime 与旧 meta 使用一个 resolver，phase/complete/cancel/move/unlink/continuity 均核对；有委派 runtime 的任务保留名字以保护身份。底层权限和上下文保持 native_default，不新增缺回执门槛。

验证：完整 CLI 2340 项通过、2 项既有跳过；core 与 adapter 通过，adapter 3 项协议/SDK请求边界检查通过；build、lint、TypeScript typecheck、packed CLI exact-core 通过。Python checker 变更文件已无错误；全仓仍有未改动的 guard-teamwork-wait.py:36 未使用 state 基线错误及既有 warnings，未扩大范围修复。GitNexus impact/detect-changes 已执行，索引落后35提交，不能替代当前源码和测试证据。

发布候选为三包同版 0.7.2-beta.5；原生 docs-site 双语 changelog 及导航已提交。版本/发布计划同时核对 adapter，CI 使用 Node22，基础 CLI/core 不依赖 SDK。源码回归不代表实际 daemon/节点、生效或恢复验收，后者交根任务 W4 在发布重装后完成。
