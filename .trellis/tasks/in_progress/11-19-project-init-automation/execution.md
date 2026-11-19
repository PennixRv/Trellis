# 实施与验证

已承接根 P3：两项显式覆盖优先，Lifecycle 只读策略查询，首次和已有平台重入调用同一原生收尾函数；Codex config/read／hooks/list 提供来源与身份，config/batchWrite 使用原生版本比较、精确键、reload 和回读。目录与受管脚本先核验，保留拒绝、禁用、未知配置及修改资产；相对或项目内 CODEX_HOME 拒绝。

CodeGraph 由其 CLI 接入及索引，使用 --project-only 和 Git 项目的 --bound-worktree，禁止 Git Hook 回退；按原生状态选择首次、sync 或 index。初次索引、空业务源码、MCP 需新会话加载及 bootstrap 待办分别报告。非 Codex 显式平台不执行 Codex 自动化。含引号路径复现旧开发者脚本 shell 拼接问题，已改为参数数组，保留 py -3 launcher。

类型、lint、build 通过；Python lint 0 errors、72 个既有 warnings。完整 CLI 回归 116 文件通过、2178 passed、2 skipped；最后补充 CODEX_HOME 边界后，真实 Codex 的 6 项原生测试均通过。已核对原生 manifest continuity（273 local、113 published、21 项既有历史豁免），beta.23 manifest 经 create-manifest 原生入口生成，docs-site 导航检查通过。

根隔离组合实测覆盖真实 Lifecycle 策略、首次／重入 Codex 信任、CodeGraph 首次索引；Git 与非 Git 项目均通过，新 MCP 从实际生成配置启动。独立 watcher 证明启动 catch-up、修改／新增／删除收敛及根外查询拒绝，相关测试进程退出。未修改真实 home-network 或发起模型请求。

docs-site main 的发布说明提交为 319b71b，已推送。候选版本为 0.7.2-beta.23；按依赖顺序等待 CodeGraph 与 Lifecycle 正式交付后，再调用 native release:beta 触发三包 CI 发布，不本地 npm publish。系统 npm／gh 空入口由根记录的已核验临时工具替代，仅影响本次开发进程环境，不修改系统或用户认证。
