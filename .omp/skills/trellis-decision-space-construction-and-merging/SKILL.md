---
name: trellis-decision-space-construction-and-merging
description: 当前任务进入决策空间构造与归并阶段时，整理实质决策、候选、证据、依赖与决策树。
---

# 决策空间构造与归并阶段

有证据的架构摩擦、具体接口权衡或重复过程设计，可采用宿主已声明的相应方法；跨方法组合不清时按需使用可用总路由。候选足够即返回本阶段，不扩成无关审计，不以方法替代用户决定或阶段接受。

当 `current_phase_id` 为 `decision_space_construction_and_merging` 时使用。阅读本 Skill 同目录的 `workflow.md`，并基于已确认且仍有效的需求基线工作。

决策空间构造与归并阶段负责展示和归并决策空间，不代替用户锁定保留决定。简单问题使用清单或比较表；只有前置选择或条件会改变后续选项时才建立决策树。阶段结果由 Trellis CLI 接受；无实质候选差异时可按证据跳过本阶段。
