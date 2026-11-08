# 实现决策与方案阶段的最小防早收敛修订并发布重装

## Goal

补强两阶段 bundled workflow 的重要分支发现、答后重算和退出依据；沿现有 beta 路线发布、重装及原生物化，保留轻量验证和干净 Git。用户授权记录位于根任务 implementation-approval.md。

## Requirements

- Modify only the two bundled phase workflow documents to challenge material defaults before handoff, reconsider decisions after answers/evidence/revisions, and show bounded completion evidence.
- Preserve existing phase IDs, native acceptance/authorization, gradual questioning and normal stopping; no fixed rounds, evaluation framework or CLI protocol changes.
- Release the next existing beta (`0.7.2-beta.4`) from `v0.7.1`, with paired CLI/core packages and docs-site bilingual changelog on its existing branch.
- Reinstall using Lifecycle's exact-version update, materialize both initialized projects using native Trellis update, and finish with committed, pushed component work and clean Git.

## Acceptance Criteria

- [ ] Source prose and diagrams agree about discovery, re-evaluation, handoff and stopping.
- [ ] Existing template checks, required release gates and artifact smoke verification pass.
- [ ] CI publishes paired `0.7.2-beta.4` packages and the installed CLI/templates match the release.
- [ ] Source and generated project assets are verified, task is closed, component commits are pushed, and Git is clean.

## Notes

- User approval: “现在完整实现并推进到发布重装和git干净状态”, following the displayed two-file minimum implementation plan. This explicitly approves requirements, the plan, implementation, publication, reinstall and Git closeout; no further approval is needed for the same scope.
- Root coordination task: `decision-design-premature-exit-review`; source baseline `4aa5dd0768b6a882ff4be41020370c708a07c77c`. No actual model-effectiveness claim is made.
- Route advice: implementation / complex / existing; complexity comes from component release and installation coordination, not implementation size.
