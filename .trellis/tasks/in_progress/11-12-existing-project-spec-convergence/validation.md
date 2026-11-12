# 验证与发行候选

## 本地源码

- 真实旧前态回归在修复前因总索引缺失失败，修复后 init/joiner/registry/safety 87 项通过；追加手工 package/scope 保全与 full force/skip 场景后 init 61 项通过。
- typecheck、lint、build 通过；Python lint 为 0 errors、72 warnings。完整原生 `pnpm test` 在 `LC_ALL=C` 下通过：Core 423 passed、1 skipped；CLI 2155 passed、2 skipped；adapter 通过。该完整运行之后增加的两项 full-init 回归已在上述 61 项聚焦验证通过，固定版本 CI 再执行完整套件。
- 中文主机 locale 导致原有两项 Git 英文诊断分类测试失败，固定 locale 后通过，未改动产品逻辑或测试断言掩盖环境事实。
- 根侧使用实际构建的 native CLI 和 CodeGraph，包含 `legacy-missing-total-index` 的组合整体通过；真实文件结果不能证明宿主信任／模型选择／MCP 连接或全局事务。
- `check-versions`、`verify-packed-cli`、changelog guard 通过；publish-plan 确认 beta.18 三包均尚未发布。新版构建通过，CLI 包精确依赖 core beta.18。

## 图与源码复核

GitNexus 索引落后 63 提交。局部 impact 为 LOW；新近 writeSpecIndex 不存在于索引，已用当前源码核对全部调用点。提交前 `detect-changes --scope all` 给出 HIGH、12 文件／16 符号／15 流程；以原生 `--limit 100` 重跑后 renderer 仍简略显示部分列表，不能当完整清洁结论。陈旧索引含已退休的 writeBackendDocs 等符号。当前实际 diff 已逐项复核，相关完整测试、安全反例和组合证据补足，未擅自重建索引。

本候选仍待公开 CI、包身份核验、原生安装和项目现场收敛；不以本地通过宣称整体完成。

## 固定候选及发布现场

最终原生提交门禁在 beta.18 上完整运行：CLI 2157 通过、2 跳过，Core 423 通过、1 跳过，adapter 4 通过。固定源码为 `5f5285838adcbef13ad9ed0812c4ec8faa5a2bd3`；维护分支及 `v0.7.2-beta.18` tag 已推送并由 GitHub API 回读一致。三份 npm pack 候选已准备，CLI 精确依赖同版 core。

固定 tag 推送与既有 `release.published` 入口暂未形成任何 Actions 运行记录。工作流及仓库 Actions API 均报告启用，GitHub 状态页未报告故障；不能据此断言事件投递根因。已对原生 workflow 执行幂等 enable，并在保持 tag 不变的前提下有限重建无资产的同名预发行，显式指向维护分支；未增加 dispatch、改变 workflow、重写 tag 或本地绕过 CI 发布 npm。

公共 npm 三包目前均未找到 beta.18。原生安装与本项目生成资产更新仍待公开发布，不把上一版本的运行记录当成本版证据。
