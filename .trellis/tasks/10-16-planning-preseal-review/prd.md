# 规划封口前复核与合并实施授权

## 目标（Goal）

落实根任务 planning-preseal-review 已展示并明确批准的 Trellis 修订范围：最终方案复核前移到 seal 之前，复用原生 seal/approve/start，保留版本与摘要门禁，同步 Marketplace。

## 需求（Requirements）

- 将最终方案展示与合并授权前移到 seal 之前，同步首次规划、继续与重规划入口。
- 用户选择封口并批准推进后，原生 seal/approve/start 连续执行；保留摘要、版本、任务和真实答复约束。
- 同步默认模板、Copilot 独立入口、bundled 参考及 Marketplace 四个有效工作流；无新状态、接口或依赖。

## 验收标准（Acceptance Criteria）

- [ ] 模板、状态提示与 Marketplace 合同一致；补充、仅封口、失败和恢复场景明确。
- [ ] 原生任务门禁、模板和相关 Marketplace 检查通过。
- [ ] 必要双包发布、安装更新与根侧物化验收完成。

## 备注（Notes）

- 授权来源：用户在根任务完整方案展示后明确批准本修订包及其 Trellis／Marketplace 组件范围；本任务是该明确范围的原生落点，不泛化父任务批准。
- 根协调：`/home/penn/devel/codex-workflow-optimization/.trellis/tasks/10-16-planning-preseal-review`。
