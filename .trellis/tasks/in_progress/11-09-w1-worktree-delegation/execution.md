# W1 执行证据

当前主会话直接实现控制面、可选公开 SDK 包、固定角色、共享节点方法、协作 Skill 和 Codex Hook。固定角色保留原生资产 frontmatter，SDK 只发送同版固定正文；任务、attempt、许可与合同保持在按次只读投影中。无 Trellis 目标不自动初始化。

当前原生控制面测试覆盖独立 Git 工作树、冻结输入、包含性、真实 commits/paths、未知创建接回且不重放、未知发送需要证据、merge/FF ancestry 与保全核销。v1 runtime 与旧 meta 使用一个 resolver，phase/complete/cancel/move/unlink/continuity 均核对；有委派 runtime 的任务保留名字以保护身份。底层权限和上下文保持 native_default，不新增缺回执门槛。

验证：完整 CLI 2340 项通过、2 项既有跳过；core 与 adapter 通过，adapter 3 项协议/SDK请求边界检查通过；build、lint、TypeScript typecheck、packed CLI exact-core 通过。Python checker 变更文件已无错误；全仓仍有未改动的 guard-teamwork-wait.py:36 未使用 state 基线错误及既有 warnings，未扩大范围修复。GitNexus impact/detect-changes 已执行，索引落后35提交，不能替代当前源码和测试证据。

发布候选为三包同版 0.7.2-beta.5；原生 docs-site 双语 changelog 及导航已提交。版本/发布计划同时核对 adapter，CI 使用 Node22，基础 CLI/core 不依赖 SDK。源码回归不代表实际 daemon/节点、生效或恢复验收，后者交根任务 W4 在发布重装后完成。

正式beta.5安装后的真实启动保留workspace_created与prepare-agent intent，原生接口在创建前拒绝已有workspace上的background参数。beta.6删除该非法参数，inspect显式包含后台/归档agent；增加主控持有原生拒绝证据且全量检查无当前attempt agent时的显式恢复，不自动重试未知创建。SDK请求边界回归及真实Git恢复fixture覆盖缺证据/已有agent拒绝和保留workspace恢复。修复和检查仍由当前会话直接完成。

beta.6 真实创建后发现 daemon PATH 仅含系统目录，裸命令 CodeGraph 无法启动 MCP；另一个已被原生拒绝的旧请求在修正参数后撞上原生幂等指纹。beta.7 由主控解析必需工具的绝对入口，adapter 验证后传入；请求键包含实际请求指纹，相同输入稳定，修正输入仅在显式对账后重试。真实 B 准备节点保持缺项、未授实施，已按 retained 原生核销并 archive agent；源码、索引、报告和工作树保留。

beta.7 正式发布与安装完成，真实A/B分别返回本树MCP来源并拒绝跨树路径；固定角色一致、动态身份不同，两个实施回合同时运行。A源码快进接受后，B经原生compact完成、同agent reload和未知发送显式接回，原生merge依赖并返工，主控全套复测与快进接受通过；真实interrupt回执丢失已对账，源码/报告保全。已有Trellis的第二目标单节点也通过必需测试、保护路径和owner集成，未写第二控制面。所有验收agent已关闭，已核销attempt及成果保全。

真实长等待还暴露了全程持有布局锁导致其他包/中断命令阻塞的问题。beta.8将原生等待移出布局与任务锁，前后重新核验当前授权、绑定及准确原生映射；另进程同时取得两把锁和陈旧attempt拒绝的回归通过。等待只读，仍不接受结果，不自动重试或取消节点。
