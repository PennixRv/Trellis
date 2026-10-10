# 实施与发布顺序

## 实施门槛

在本任务当前修订取得明确批准前保持 planning。当前 inline 主会话不派发 implement/check 子代理，不为此填写 JSONL；通用 validate 会对本任务已存在的空 implement/check JSONL 报错，获批准后通过原生 `task.py start <task> --allow-empty-context` 启动，仅放行上下文清单检查，不替代 seal/approve。启动时读取 Trellis CLI/Core 规范，并核对所有受影响调用方与测试。编辑前按仓库要求运行 GitNexus impact，提交前运行 detect-changes；若工具或索引不可用，记录 `not_run`，并使用范围明确的本地调用方/测试证据替代。此单代理计划不派生子代理。

## 有序工作

1. 重新核实 beta 分支 HEAD、tag、包版本和所有子模块 remote。若 `.44` 已不是下一个版本，先更新计划，再处理依赖发布的 pin。
2. 修改 Marketplace 当前选定的 `codex-subnode-channel` 工作流及其派发/Planning 边界合同测试，补充 inline/Channel 边界和写入前目标分类；不改 Native Workflow。先提交并推送 Marketplace。
3. 更新 Trellis 模板、思考指南模板及 Trellis 自有指南副本。新增或更新模板测试，覆盖资产所有权、条件派发/授权、归档前验收、批量历史研究资源边界、移除无依据比例，以及通用 Channel 模式的适用范围。
4. 实现 Codex search/context 遍历与有界结果选择、共享 JSONL UTF-8 解码和严格 context 字符预算。在 `packages/core/test/mem/adapters.test.ts`、`api.test.ts`、`helpers.test.ts` 和适当的 reader 测试中增加覆盖。保持现有 API 形状和非 Codex 适配器行为。
5. 先运行相关 Core 测试，再运行 `pnpm --filter @pennixrv/trellis-core lint`、`typecheck` 和 `test`；运行 CLI 定向测试、lint、typecheck 和全量测试。使用合成 8/32 MiB Codex 资源探针重新测量；记录输入/输出、读取字节、RSS 和限制，不读取真实会话或 Office WSL。
6. 准备下一个有效 beta manifest，通过发布工具同步 CLI/Core 版本，更新英文/中文 changelog 和 `docs-site/docs.json`。构建后运行 release-preflight、`npm pack --dry-run --json`，再在全新临时 Git 项目中运行构建后的 CLI，并核验相关生成文件、哈希和 `trellis update --dry-run`。
7. 推送 docs-site 子模块更改并确认远端可达，然后在 `pennix/v0.7-beta` 提交 Trellis gitlink 和源码。按要求执行完整发布流程。官方 CLI/Core 发布只能由 CI 完成；确认两个公开包版本、dist-tag 和发布工作流后，才能记录发布完成。

## 完成证据与回退

记录 Marketplace/docs-site/Trellis SHA、CI run/tag、配对包版本、测试结果和任何 `not_run` 检查。只通过可达 Git commit 和原生 update/install 命令回退源码及模板安装，并保留项目本地文件。不得删除会话数据、修改数据库、强行安装包或手动改写安装缓存。只有根协调任务接受所有共享集成证据后，才完成并归档本组件任务。
