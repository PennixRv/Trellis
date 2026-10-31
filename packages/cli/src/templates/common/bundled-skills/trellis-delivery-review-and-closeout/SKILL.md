---
name: trellis-delivery-review-and-closeout
description: 当前任务进入交付审查与收尾阶段时，核对当前交付候选、未结事项、接受条件和资源处置。
---

# 交付审查与收尾

当 `current_phase_id` 为 `delivery_review_and_closeout` 时使用。阅读本 Skill 同目录的 `workflow.md`，只审查当前路线和 revision 下的交付，不在本阶段重新设计或实施。

阶段 5 核验交付与合同、接受条件、工作包、集成、验证、未结发现和资源事实。当前合同内缺口按最早受影响阶段回流或暂停；合同外遗留应记录责任方、触发条件、影响和后续引用。满足交付条件后由 Trellis CLI 接受；只有明确撤回才进入取消处置。会话交接包是独立附加操作，不是阶段或任务收尾的前置条件。
