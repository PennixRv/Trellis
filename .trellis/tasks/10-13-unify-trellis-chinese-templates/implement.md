# 实施步骤

1. 根任务获批准并启动本子任务后，核对分支、工作区和源模板清单，读取适用 spec。
2. 修改源模板、默认生成器、workflow 阶段消费者、journal 写入/读取逻辑和必要测试；每次变更保留机器合同并复核差异。
3. 运行既有与新增测试，覆盖旧/新 workflow 标题、跨平台副本、PRD 生成、旧/新 journal 续写、更新冲突、protected paths 和 Marketplace 边界。
4. 运行 `pnpm --filter @pennixrv/trellis test`、`build`、`lint`、`typecheck` 及适用检查；记录未运行项和限制。
5. 通过质量门后提交并推送 Pennix fork，按原生 beta 流程发布；把实际版本、commit 和发布回执提供给根任务，以便更新 lifecycle catalog。
