# Teamwork 容量配置整改执行记录

本轮沿已接受的 `teamwork-capacity-remediation.md` 实施，不重开已定选择。实现目标为本 Trellis 源仓；根仓只记录组合验收和审查包。

## 实现与验证

- `.trellis/teamwork.json` 升为 schema 2，唯一持有模式成员数、并发上限和共享资源预算。默认成员 1/3/3，并发 8/3/3，live 预算 8，预留 0。
- advisor 计划构造与底层验证均接受 1–3 位；committee 保留 distinct lenses。batch/coordinator 按实际模式解析容量，交互 guard 共用 JSON 预算；既有共享锁、存量进程和持久化租约的准入逻辑保留。
- schema 1 保留兼容；schema 2 忽略旧 YAML 容量键并诊断。环境覆盖明确提示，config/preflight 暴露 `capacityPolicy` 及来源，batch 诊断走 stderr。损坏 JSON 不静默回退。
- 同步模板、Teamwork Skill、meta 参考、CLI 规范和双语指南；docs-site 提交 `be3ede0` 已推送。原生工具生成 beta.19 manifest。
- 定向 45 项通过；全量 Core 423 通过、1 跳过，CLI 2307 通过、2 跳过。lint、typecheck、docs 全量 lint（679 文件）、manifest continuity 与 changelog guard 通过。
- GitNexus impact 确认 batch/coordinator/guard 消费链，guard 与容量入口标记 HIGH 风险；提交前 detect_changes 覆盖关联执行流。图索引存在历史滞后，实际源码与全量测试作为最终验证依据。

## 发布

源码提交 `b6619b76`；锁步版本提交 `2ac2a7a0b1a28cb3908d11a4641285a7ac200b9a`，标签 `v0.7.1-beta.19` 已推送且属于远端 v0.7.1 分支。发布由 GitHub Actions `42008533817` 负责，不执行本地 npm publish。最终安装和资产核验在后续记录补充前不视为完成。

后续核验：该流水线首次被 npm package processing 的公共可见性延迟阻断（18 次 E404），两个 publish 实际已获接受。公共 registry 均可查询 beta.19 后原生 rerun failed，第二次成功并跳过重复发布。Pennix 原生 `update trellis-cli --version 0.7.1-beta.19` 成功，候选/安装归档 SHA-256 为 `337186e7bd7a8ac9f768035767e15268674e62492da11d326be056445fe91f92`；安装后的 CLI/Core 及精确依赖均为 beta.19。

两仓原生 update/dry-run 与 native workflow 复核完成。根仓安全更新 6 文件，保留专用 `.codex/config.toml`，其 SHA-256 前后均为 `659b0863837d86a5bd92ebca7f9e397a00adea78e7fc5446e72a0c8ffa699edd`。本仓安全更新 21 文件，保留自定义 config/.gitignore；仅合并 config 中已授权的容量键退休，不覆盖包与执行专用配置。双方版本均为 beta.19，三模式实际 config 输出分别 1/8、3/3、3/3，live 8/reserved 0，diagnostics 均为空。没有生成 `.new`。

更新原生创建了两份可回退备份：根 `.backup-2026-11-05T10-24-05-538Z-36b384cb-d3b8-4ffa-a50c-80984dd4b48f`、本仓 `.backup-2026-11-05T10-24-07-352Z-440bfd0e-a413-4c60-8c52-aac651dbefc2`；不提交 Git。根组合门第一次只因 gitlink 尚未固定而失败（10 通过/1 失败），固定后再验收，不掩盖中间失败。

## 调用问题及处理

1. 双仓新合同第一次 accept 缺覆盖表，原生报 `TASK_PHASE_COVERAGE_REQUIRED`；补齐覆盖后重新登记 artifact 并原生 accept/authorize，未手写任务状态。
2. 几次候选读取路径错误（config 模板实际位于 templates/trellis；上下文装载位于 context-loader.ts），以及根目录并无 package.json，按实际文件列表修正；不是工具缺失或产品错误。
3. 一次多文件 apply_patch 因末尾上下文不符整体失败，核对未写入后拆分修正。Prettier 从 workspace 根执行找不到命令，改在 CLI package 运行。
4. lint 发现 mode schema 工厂缺显式返回类型，修正后 lint/typecheck 通过。第一次完整测试达到 50 秒工具限时，未当作通过；后续完整执行返回退出 0 和上述全量结果。
5. 一次原生 exec 指定 submodule cwd 被 Hook 拒绝：native Codex thread cwd 与 hook cwd 不符。未绕过权限；Context Mode 的真实 owner 调用完成等价检查，之后需要 continuation 的调用保留宿主根 cwd，由 Git 原生 `-C` 选目标。
6. release:beta 工具调用 260 秒超时，核对原进程已退出、仅预发布提交和 staged 版本变更，无远端新 tag；从未完成的原生版本 commit 续接。该 commit 的完整 pre-commit 测试通过，随后校验版本、tag/push 并核对远端 ancestry。没有重复运行 bump 或重发旧版本。
