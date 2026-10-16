# 实施计划

1. **固定恢复范围和现有回执。** 保留版本提交 `08e8aecff297698937f7cdc1a24597b9f91ac25b`、tag `v0.7.0-beta.51`、GitHub Release 和现有 CI 运行；不删除或重打 tag／Release，不在本机直接发布 npm，不为改变运行列表标签重复发布。
2. **撤回 main 临时入口。** 从当前远端 main 建立干净临时工作树，以新 revert 提交精确撤回 `56f023b6`、`c0a26299` 的工作流差异；核对工作流与改动前一致、无产品源码差异，再推送 main。不 force push，不重置或覆盖其他提交。
3. **恢复 beta 发布路径。** 在现有 `task/planning-preseal-review` 移除本次临时新增的 workflow_dispatch／source_ref 及专用说明，恢复 tag push／Release published 和原生标签检查；保留本任务产品修复、双包校验、构建测试、打包与公开 npm 回读。核验通过后按既有 beta 分支合同收敛到 `pennix/v0.7-beta`，不把 beta 产品合入 main。后续发布由 beta 线的版本 tag 触发。
4. **核验公开制品。** 使用 Trellis 原生 `verify-npm --package all` 或等价的仓库发布核验确认 `@pennixrv/trellis-core` 与 `@pennixrv/trellis` 的 beta.51 精确版本；公开回读通过后才继续安装。
5. **升级与物化。** 使用已核验的 lifecycle 原生入口升级 `trellis-cli`，运行 scoped verify；按已有项目 owner 更新受影响的 Trellis 生成资产，核对来源、摘要和用户无关改动。
6. **完整验收与收敛。** 运行 Trellis 专项检查、根侧离线集成验收和必要安装回读，记录 passed、failed、blocked、not_run；所有验收成立后提交 execution 记录，按原生任务入口归档。

验证包括 main 撤回后的精确工作流比较、beta 分支发布差异检查、既有 release-preflight 合同及必要提交钩子检查、公开双包版本／发布 tag 核验、安装 scoped verify、三处项目来源及只读组合门禁。main 撤回失败时停止推送并保留回执；若需要恢复入口，也只能通过后续明确批准的新提交。安装回退使用 beta.50 的现有版本与已记录组件提交；任一步失败时保留 beta.51 catalog 目标和原始回执。禁止本机 `npm publish`、删除或重打既有 tag／Release、手改任务批准或绕过原生 CI 合同。
