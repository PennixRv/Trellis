# Teamwork 状态机收敛实施记录

## 当前状态

按已接受的需求与实施合同，在 Trellis submodule 中修复 Teamwork Core/CLI 状态机与运行时，并更新随包分发的 Teamwork Skill、teammate role card 和 CLI 规范。`0.7.1-beta.16` 已发布到 beta dist-tag，并通过 Pennix Lifecycle 精确安装到 `trellis-cli`。未调用 Teamwork teammate。

## 已完成

- [x] 确认源码位于 `v0.7.1` 维护分支，基线提交与远端一致，开始前工作树干净。
- [x] Core 允许队列中的 assignment 在取消或超时收敛时进入 `FINAL_FAILED`，并有状态迁移回归测试。
- [x] CLI 协调器核验任务阶段与路由新鲜度；区分缺失、无效与不可读报告；处理 FIFO 关闭、并发取消、重试预算、协议 ID 上限和终态 receipt 重建/核验。
- [x] 将等待实现为协调器管理的并发 wait set；同一进程等待不消耗 provider work 重试预算，其他活动 slot 可继续推进。
- [x] 增加 CLI runtime 子进程测试，验证同一进程续等、deadline 和取消确认；增加 Core、coordinator、report、模板分发回归测试。
- [x] 更新 bundled Teamwork Skill、teammate role card 与 `.trellis/spec/cli/backend/commands-teamwork.md`，明确 FIFO 控制权、等待语义、取消和报告处理。
- [x] CodeGraph 核对 Core transition/reducer、CLI coordinator 与 report validation 的调用影响和测试覆盖；环境未提供 GitNexus CLI。
- [x] 全量测试曾通过：Core 423 passed、1 skipped；CLI 2261 passed、2 skipped；构建通过。
- [x] 最近一轮 `pnpm lint`、CLI typecheck、Teamwork 定向测试通过（63 tests）。
- [x] 使用 CLI 包内 Prettier 格式化变更源码并检查所有变更代码、模板与任务记录。
- [x] 通过 Trellis 原生 manifest generator 创建 `0.7.1-beta.16`；声明无需迁移。
- [x] 创建并推送 docs-site 中英文 beta.16 changelog；更新并提交 Trellis 的 docs-site gitlink，beta 发布文档门禁通过。
- [x] manifest 连续性检查通过；确认原生发布脚本排除 `.trellis/` 与 `docs-site` 的暂存范围，并检查当前变更清单。
- [x] 打包 CLI 校验通过；发布工作流的 Core/CLI typecheck、build、全量测试、packed CLI、两个 npm publish 和 npm 验证全部成功（GitHub Actions run `41829145100`，tag `v0.7.1-beta.16`）。
- [x] npm registry 确认 `@pennixrv/trellis-core@0.7.1-beta.16` 与 `@pennixrv/trellis@0.7.1-beta.16` 均可解析；两个包的 `beta` dist-tag 为 `0.7.1-beta.16`，`latest` 仍为 `0.7.1`。
- [x] Pennix Lifecycle 对 `trellis-cli` 精确执行 `0.7.1-beta.16` 更新并返回 `changed`；receipt source 为 `npm:@pennixrv/trellis:latest`，target version 为 `0.7.1-beta.16`，SHA-256 为 `135727aed76f50af7b72fabedae8cc4aa912bf380945f8bc343bac6938042a2c`。
- [x] 安装后 `pennix status --json` 中 `trellis-cli` 为 selected、lifecycle-owned、`match`；实际 CLI 与其解析的 Core 版本均为 `0.7.1-beta.16`。安装包内 Teamwork Skill、plan-construction 参考、teammate role card 与 beta.16 migration manifest 均存在。
- [x] 执行 `pennix check --json`；全局检查因其他组件的既有 outdated/blocked/pending 状态返回 1，`trellis-cli` 仍为 `match`。未修改这些无关组件。该结果不等同于 `functional_checks`，后者显示 `not_requested`。
- [x] 在 Pennix update receipt、实际 CLI/Core 版本、包内关键资产和 npm dist-tag 均核验后，确认 beta.16 精确安装完成。

## 发布结果与剩余工作

- `pnpm release:beta` 在 Context Mode 的 240 秒命令时限内完成全量测试、构建及脚本前半段；命令超时后先检查工作树、进程与 refs，再按 `release.js` 的剩余原生发布步骤提交已暂存版本、创建 tag 并推送 branch/tag。远端 `v0.7.1-beta.16` 与 `v0.7.1` branch 均指向 `379195ac78f3fcbce00d1048b46ab6b02725175d`，tag CI 与 npm 核验成功。
- `trellis --version` 输出 `0.7.1-beta.16`，同时提示项目版本 `0.7.1-beta.15` 可通过 `trellis update` 更新。该提示表示当前项目生成资产版本落后于 CLI；本任务已验收的是全局 CLI/Core 精确安装与随包资产，未执行项目资产迁移。
- 下一步由 Trellis 原生任务接口接受本阶段实施结果，再完成组件交付审查；之后由根仓记录并验收 Trellis gitlink 集成。

## 验收边界

若结构影响、release preflight、CI 或 npm 精确版本核验失败，停止发布后续步骤并记录实际阻塞；不得手工发布、移动已有 tag、使用 teammate 或清理未确认的运行态。全局 Pennix 检查的无关组件状态不通过本任务授权进行修复；项目生成资产迁移也不替代本任务定义的全局 CLI 安装验收。
