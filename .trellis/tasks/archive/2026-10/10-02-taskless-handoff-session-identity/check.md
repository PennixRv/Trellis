# 验证与发布

2026-10-02：CLI 2185 passed / 2 skipped，core 408 passed / 1 skipped；lint、typecheck 与 CLI Python basedpyright 通过。新增 task current JSON 字段不改变 task pointer source 或原有退出码；无任务且具备宿主身份时可返回独立 session_source。GitNexus impact 标记 7 条依赖流，调用合同和回归已核对。

Marketplace main 63b57e4 已推送；RecoveryBrief 明确 AgentMemory memory-id/project/type/content 精确证明、taskless seal 和既有 task ownership。Marketplace 回归 3/3。

beta.22 发布 CI 36961288003 成功。随后通过 --no-ignore 补查发现 bundled trellis-channel workers.md 的旧 Hindsight env_file 说明；父协调仓库忽略子组件导致首次检索遗漏，源码修正并连续发布 beta.23，不改历史 tag。

beta.23 tag/source a39818be93f9347120ce7b1d3f9645a27ebeb322 已推送。CI 36962069983 首次上传两个 npm 包成功，但 public registry 暂未显示 core；重跑返回 staged version E409。随后原生 release-preflight verify-npm --package all 成功：两包指定版本与 beta tag 均可用，已再次重跑流水线收敛状态。

CI 36962069983 最终 success。本机已原生升级 beta.23，根 native update 自动采用 task.py / workers.md；Marketplace 63b57e42e7c2380b55eaf2f682e04f857c2de041 已采用并 verify。整体 lifecycle verify=match，根离线组合验收 8/8。归档后用户原请求的真实 taskless 正式交接以独立 ready receipt 为准。
