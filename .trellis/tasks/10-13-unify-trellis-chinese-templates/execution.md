# 实施与验收

## 源码验证

实施分支已快进至现行 `origin/pennix/v0.7-beta`（`8387a39a`），发布基线为 beta.46，避免从旧 beta.43 发布而遗漏前序增强。纳入的 17 个 spec 源模板及 workflow、PRD、workspace、个人 index/journal 已改为中文优先；代码示例保留。cross-platform 源模板不新增默认导出，实际生成集合保持原合同。

Python、三套 SessionStart Hook、OpenCode 已通过旧英文/新双语完整标题、相似前缀排除、阶段边界和面包屑排除测试。保存校验同样改为完整标题。旧英文日志续写和跨 ref 编号测试通过；跨 ref 正则使用 Git 的 POSIX ERE，避免 Python 非捕获组导致编号遗漏。轮转新文件与初始文件保持同一中文标题。

完整检查：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 通过。Core 432 通过/1 跳过；CLI 2271 通过/2 跳过。随后新增保存校验四种标题边界用例，待定向测试及发布原生全量复验。中文文案检查覆盖本次 21 个文件，error=0、warning=0；样式建议按约定保留普通中文引号和日志原文。所有 spec 与 workflow 的 fenced code 示例已与基线核对，保持原样。

GitNexus/CodeGraph：本会话此前已尝试，目标仓库无可用索引，依项目能力边界不重复尝试；不宣称图检查通过。真实发布包 init/update 与安装验收仍待完成。

## 发布、安装与最终验收

源码提交 `632915aa`，版本提交 `4cf4501b7853f48a4b3d8819db93eaba3effbb3e`，均已推送实施分支与 `pennix/v0.7-beta`；标签 `v0.7.0-beta.47` 已推送。原生 beta 流程已发布 `@pennixrv/trellis` 与 `@pennixrv/trellis-core` 的 `0.7.0-beta.47`。首次 CI 发布后的 npm 传播核验超时，随后实际 npm 核验通过；原生重跑失败步骤后，CI [38357068409](https://github.com/PennixRv/Trellis/actions/runs/38357068409) 成功。未另外执行本地重复发布。

发布流程全量复验：CLI 2275 通过、2 跳过；Core 432 通过、1 跳过。lint、typecheck、build 均通过。docs-site `bc57e1be7e0113bb8d5b48349914c925c2448203`、Marketplace `786f7b90d888b61c7562f9ace25569ed19c9e82d` 均已推送 main；原生工作流镜像 SHA-256 为 `8c3e67d70bf3e52c8c6efd90d3b776bd6aa01ea6d9fa32160beae239f3ddb7f2`。docs-site 同步修复原有中英文共享导航不一致，原生提交门禁通过。

Pennix lifecycle 已将 CLI 精确版本锁定为 beta.47，并通过原生 upgrade 安装；`discover` 与组件 `verify` 都为 `match`，无失败或 advisory。安装前 Channel 核验未发现活动 worker。

| PRD 验收项 | 实际结果与证据 |
| --- | --- |
| 全部纳入模板与机械合同 | 原生 workflow、PRD、workspace、个人 index/journal 及 17 个 spec 源模板均覆盖；代码围栏与 beta.46 基线字节一致，机器标记测试通过。cross-platform 源模板原本不导出，实际默认生成集合仍为 16 个。 |
| 全消费者双格式解析 | Python、三套 SessionStart Hook、OpenCode、保存校验覆盖旧英文与新双语完整标题、相似前缀排除、边界和状态投影；定向与全量测试通过。 |
| 历史续写与不迁移 | 旧英文 session 8 续写新格式 session 9，旧字节保留；分支最大编号、去重、恢复及轮转合同回归通过。已发布包的旧项目 PRD、workspace/spec 更新后字节不变。 |
| 真实 init/update 与归属 | 已安装的发布包在 Claude、Codex、Copilot、OpenCode 四平台临时项目 init、中文生成、哈希登记及 update 无操作通过；beta.46 干净 workflow 自动升级；用户修改的 workflow 在 skip 和 create-new 下保留，force 才覆盖；第三方 `codex-subnode-channel` 的内容与来源记录保持。临时项目均已清理。 |
| 组件质量与能力限制 | 原生全量测试、lint、typecheck、build 通过；3 项已有跳过用例保留。GitNexus 无可用索引，未宣称通过；平台验收为同一 Linux 宿主中的真实生成与消费者测试，未声称在其他宿主操作系统实机运行。 |

以上证据满足本任务验收；已封口的规划文档保留批准时原文，完成状态由本记录与原生归档表达。
