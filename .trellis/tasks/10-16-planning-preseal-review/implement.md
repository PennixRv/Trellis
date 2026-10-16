# 实施计划

1. **固定发布恢复范围。** 保留已存在的版本提交 `08e8aecff297698937f7cdc1a24597b9f91ac25b`、tag `v0.7.0-beta.51` 和 GitHub Release；不删除或重打 tag／Release，不在本机直接发布 npm。
2. **修订发布入口。** 在 `.github/workflows/publish.yml` 增加受控 `workflow_dispatch` 与 `source_ref` 输入，并让 checkout 按输入选择已存在的 beta.51 tag；保留原有版本对齐、构建、测试、打包依赖核对、双包发布和公开 npm 回读步骤。
3. **提交并触发 owner CI。** 在现有 Trellis 任务分支提交并推送工作流修订，通过 GitHub Actions 原生手动入口以 `source_ref=v0.7.0-beta.51` 运行发布。保留完整运行 URL、状态、失败步骤和 npm 回执；CI 未成功时停止，不改 catalog 制造匹配。
4. **核验公开制品。** 使用 Trellis 原生 `verify-npm --package all` 或等价的仓库发布核验确认 `@pennixrv/trellis-core` 与 `@pennixrv/trellis` 的 beta.51 精确版本；公开回读通过后才继续安装。
5. **升级与物化。** 使用已核验的 lifecycle 原生入口升级 `trellis-cli`，运行 scoped verify；按已有项目 owner 更新受影响的 Trellis 生成资产，核对来源、摘要和用户无关改动。
6. **完整验收与收敛。** 运行 Trellis 专项检查、根侧离线集成验收和必要安装回读，记录 passed、failed、blocked、not_run；所有验收成立后提交 execution 记录，按原生任务入口归档。

回退使用 beta.50 的现有安装和已记录组件提交；发布或安装任一步失败时保留 beta.50，保留 beta.51 catalog 目标和原始回执。禁止本机 `npm publish`、删除或重打既有 tag／Release、手改任务批准或绕过原生 CI 合同。
