# Trellis 设计

本owner承担有效AGENTS诊断、项目能力约束及用户D11的决策入口/执行升级。native research/start guard、Channel报告权限与状态结构不变；Marketplace源由其PRD-only owner同步，不借机重写生命周期。

init/update在当前managed AGENTS流程查询同级非空AGENTS.override.md并给出有效源遮蔽诊断；物化普通文件仍可安全合并，但成功信息不能暗示生成规则必然被宿主加载。沿现有路径/marker安全逻辑，保留user-owned文件；不重建一个Codex发现器或用它代替宿主。

源码项目GitNexus前提由项目AGENTS的user-owned区域表达，精确说明上游生成区内MUST只在已信任且已部署的能力下适用。缺少能力允许本地读取/检索并明确未运行graph检查；禁止从该指导隐式执行latest下载、bootstrap或重建索引。治理该指导本身属于项目文档变更，无需为分析提示词先安装可选graph工具。

CLI/core保持同版本beta.43。docs-site的当前checkout可能detached，实施时在其main安全切换/fast-forward且保留已有内容，完成英文/中文changelog与docs.json导航后先推送；Trellis固定该commit，并生成对应migration manifest，再原生release:beta/CI。不得跳过docs门或对tag/npm制品手改。

决策入口在`packages/cli/src/templates/common/skills/brainstorm.md`及`src/templates/trellis/workflow.md`突出：先筛选真实用户选择，事实不能替代产品意图；依赖决定ready资格后按影响/阻断优先级提问，不预先穷举。答案可新开/淘汰后序分支；空frontier但证据未完成不得封口。边界清楚研究无需凑问题，局部/已定选择免问；普通继续不重开决策链。具体方法引用Pennix grill，项目只维护入口、记录与原生阶段，不另存决策运行态。

执行实质未决选择先立即报告/暂停依赖，再in_progress native replan后阻塞grill；planning不误调replan，仅更新计划重封口。不用先做后补问，不因局部低风险增量撤销已授权任务。Marketplace native/channel源与bundled合同一起验，不修改其他workflow的独立方法。

Marketplace commit/index摘要先推送main，Trellis固定其gitlink；7个本机消费者保留原workflow选择，通过native更新对应来源。docs-site同样先推送再固定，release门不能跳过。

测试使用现有init/update/managed paths suite的隔离fixtures验证override诊断与文字保持；图前提做有/无能力且无网络副作用的合同场景。真实图或模型未运行时按not_run报告。
