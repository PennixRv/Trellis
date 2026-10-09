# AGENTS 有效源与项目能力前提修复

## Goal

承接根任务10-09-agents-skills-layering-remediation：SAG-02项目与SAG-06，规划override诊断、图工具能力前提及beta.43发布，不实施。

## Requirements

- Owner：本 Trellis fork，`pennix/v0.7-beta`；基线 `6640959363a4a6f269dfc56f9c38b4f6771e8cdb`，CLI/core beta.42。根任务：`/home/penn/devel/codex-workflow-optimization/.trellis/tasks/10-09-agents-skills-layering-remediation`。
- SAG-02项目：init/update保留普通AGENTS受管合并，但准确诊断override有效源，不覆盖user-owned或override。
- SAG-06：本源码项目自有规则声明GitNexus可信已部署的能力前提；未具备时有界本地证据可继续且不谎报图检查，不从只读/普通编辑自动npx/dlx/latest/analyze。
- 图前提写在上游生成区外，限定该区MUST的适用条件；不fork GitNexus、不改索引/runner缓存，生成后验收前提仍存在。
- 用户D11：brainstorm与bundled native流程明确非研究默认筛选真实用户取舍，按优先级/依赖分轮；执行实质歧义立即报告，in_progress原生replan后阻塞提问，planning正常重封口，不给局部事实造门。
- 决策树渐进演进，不要求一次穷举；答案可新开/淘汰后序分支，证据依赖未完成的空frontier不能封口。具体问答方法由Pennix grill持有，项目源只声明入口、阶段与记录，不复制第二套决策schema。
- CLI/core目标`0.7.0-beta.43`，原生beta release/CI发布；release docs-site独立owner交付双语changelog/docs.json，migration manifest满足现行门禁。
- Marketplace为实际新增owner：native/codex-subnode-channel源同步上述决策入口/执行升级并更新index摘要/tests；先提交推送main，Trellis固定真实已推gitlink再发版。
- 本task当前只规划，实施需本任务seal后的明确批准，不能仅继承根批准。

## Acceptance Criteria

- [ ] init/update对无/空/非空override与嵌套目标正确输出有效源信息，原文本与override保留。
- [ ] 项目图工具有/无、离线、只读场景无隐式下载安装/重建；没跑图不能报通过；生成区刷新不删自有前提。
- [ ] 相应CLI测试、lint/typecheck/build和原生release/version/docs/manifest门禁通过。
- [ ] brainstorm/bundled/Marketplace源的决策筛选、研究例外、依赖分轮与执行及时升级一致，native状态/批准结构不改。
- [ ] CLI/core beta.43提交/tag/CI/公开npm一致；消费者通过native更新而非手复制源码。

## Notes

- docs-site发布文档任务位于该独立checkout的`.trellis/tasks/10-09-agents-effective-source-release/prd.md`，保持PRD-only，不因文档动作隐式初始化整套workflow。
