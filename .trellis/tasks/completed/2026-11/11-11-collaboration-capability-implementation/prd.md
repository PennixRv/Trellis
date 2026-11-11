# 协作能力、委派状态与命名规范实施

## Goal

关联根任务 collaboration-tool-capability-audit；执行已批准第11版合同 WP1：委派输入冻结、终态/授权失效控制、已证实 Teamwork 入口问题及协作命名规范，按源码 owner 验证。

## Requirements

- 执行根任务第 11 版 implementation-contract.md 的 WP1，根控制任务位于 `../.trellis/tasks/in_progress/11-10-collaboration-tool-capability-audit/`；用户实施批准见其中 implementation-approval.md。
- 在当前 owner 分支修复准备材料、角色与节点方法冻结和稳定读取，拒绝不完整旧绑定的新执行。
- 退休后禁止发送；父授权失效后保留身份受控的观察、取消与保全核销，不重新授予实施许可。
- 按已批准映射统一 Trellis 团队协作／团队成员及 Paseo 并行协作／委派 Agent 的相关说明；机器标识保持兼容。

## Acceptance Criteria

- [x] 当前共享控制入口、节点读取和对应 Git/文件系统回归覆盖冻结、漂移、终态与失效授权。
- [x] 已证实的 Teamwork 入口问题局部修复；elicitation 先核验，不假设用户提问需求。
- [x] 源模板与 dogfood Python 保持原生要求的一致性，针对性测试及适用 lint/typecheck 通过；既有 Python unused state 检查错误单列根任务，不宣称全部 Python 静态检查通过。
- [ ] 发行准备及安装后的真实协作由根控制任务集成验收；不以本地测试替代现场交付。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
