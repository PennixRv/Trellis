---
name: trellis-goal-exploration-and-requirements
description: 当前任务处于目标探索与需求核对阶段时，核对目标、范围、成功条件、约束、证据与用户确认。
---

# 目标探索与需求核对阶段

根据当前问题选择宿主可用方法：重要用户取舍、零散素材、学习目标或理解障碍分别采用适用方法，不要求用户点名。只加载相关入口，产物返回本阶段；可选方法缺席不阻断原生流程，也不替代需求确认。

当 Trellis 任务的 `current_phase_id` 为 `goal_exploration_and_requirements` 时使用。先阅读本 Skill 同目录的 `workflow.md`，再按当前项目事实选择必要的探索深度和证据来源。

阶段产物和用户确认通过 Trellis CLI 记录。离开本阶段前，必须由用户明确确认绑定当前 `artifact_revision` 的目标与需求基线；只要求修订或尚未确认时，继续停留在本阶段。确认不等于最终方案批准或实施授权。
