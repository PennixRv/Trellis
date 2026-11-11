# 验证与固定交付候选

固定候选为 `v0.7.2-beta.17`，源码 `bafc7adbee3a43cde4042810af20afc451cc7f02`。CLI、Core、Paseo adapter 同版，CLI 精确依赖同版 Core。原生发布及公共 npm 核验通过；[CI 43050614440](https://github.com/PennixRv/Trellis/actions/runs/43050614440) 第二次运行成功。第一次在 npm 处理窗口内无法读到 CLI，未重复发布或重写 tag。

源码移除了旧角色生成、上下文分发 Hook、Codex mode 解析、虚拟平台与状态、Pi 子执行器、OpenCode 角色物化器及相应接口、注册和旧功能测试。保留主会话上下文、普通 check Skill、可选 JSONL、Kiro 主入口及现行 Teamwork/Paseo 角色。退休路径和精确旧配置片段只用于安全删除或拒绝恢复，没有旧执行模式的兼容解释器。

完整测试：CLI 110 文件、2145 通过、2 跳过；Core 25 文件、423 通过、1 跳过；adapter 4 通过。连续更新与退休资产聚焦测试共 85 项通过。类型检查、lint、构建通过；Python 检查为 0 errors、72 个既有 warning。22 平台的 1307 个生成文件通过执行资产校验，最终 CLI 包共 992 文件。docs-site 716 文件 lint 无错误，共享导航一致。

CLI 与 adapter 已通过 Lifecycle 原生入口安装为 beta.17。CLI 归档 SHA-256 为 `62bc79d8d0cf25bd1c783ac9df2cb741b507ab80891a8fc0b4a422fe7953612a`，adapter 为 `e2f7b7fe1c600adca8b12a56c9ba145e236d02baaeaca3ca71a68e99139b7e1c`。原生 owner 检查均为 match，恢复状态 idle。

本组件项目已由原生 CLI 更新为 beta.17，旧执行文件共移除 22 个。包映射配置按用户修改保留，receipt 收敛到模板基线。更新前后 1579 项任务、spec、工作日志和 AGENTS 非托管内容记录一致，5 份混合配置字节相同；实际主会话 Hook 的 3 项测试通过。根项目旧备份的只读恢复预览拒绝激活旧原生角色，没有执行恢复。

新增回归先证实原实现的连续更新和混合 receipt 保护失败，再修正基线写回与自动覆盖判定。已有混合 receipt 不能授予整文件覆盖权限，`--skip-all` 保留用户内容；Reasonix 同路径替换及写前指纹复核继续通过。

全部实施和发布操作由当前主会话执行，没有启动任何真实代理或付费模型。图索引滞后，新增退休计划符号为 UNKNOWN；按现行调用、完整回归和平台矩阵补核，未将图的空结果作为安全证明。真实模型遵循性不在本次无模型验证结论内。
