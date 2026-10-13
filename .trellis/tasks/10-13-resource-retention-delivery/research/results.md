# 交付与验证

首次实现 `27f4745`，已发布 beta48；验收复查补齐 update/prune 共用锁、备份候选与预估量、实际成功/失败回执和释放量。真实项目资源未删除。

全量 core 432 passed/1 skipped、CLI 2280 passed/2 skipped；typecheck/build 通过。随后新增 update 与 prune 排他回归，定向 update/backup 72 tests 通过。发布入口还会执行全量测试。

全仓 lint 仍受既有 `workflow.integration.test.ts:84` 未使用 `TDD_SHA256` 阻断，不修改无关问题；修改文件的 ESLint/Prettier 定向核验另行执行。GitNexus impact/detect 已执行，索引落后 157 commits，实际调用方与回归测试补证，不宣称图覆盖完整。

追加版本 beta49；发布和安装证据由根任务保留精确 SHA、tag、run 与生命周期回执。回滚使用 beta48，保留备份和 Channel 用户资源。
