# Trellis Teamwork state-machine closure

## Goal

Converge the 12 findings in root task teamwork-audit-findings-convergence on the v0.7.1 maintenance branch. Implement the accepted Core, CLI coordinator/runtime, and bundled Skill contract; no teammate delegation. Publish 0.7.1-beta.16 through the native CI release path and reinstall that exact version through Pennix.

## Requirements

- The root coordination task is `teamwork-audit-findings-convergence`; its accepted implementation contract is revision `b71b074b8cd40ce567c6cdaabb5730dfb3b5d065d8d58f801ef4b830a326856e`. That contract is authoritative for behavior and scope.
- Recheck branch `v0.7.1`, current HEAD, remote maintenance tip, and all 12 findings before source changes. Implement in this Trellis repository only; do not use Teamwork teammates or delegate the Teamwork audit/implementation.
- Close findings F1-F8 and S1-S4 across Core state transitions, CLI coordinator/recovery, production runtime waiting, and bundled Skill/teammate instructions. Keep plan, batch, assignment, and provider attempt facts distinct.
- One foreground `teamwork batch` invocation owns FIFO dispatch, waiting, retry, cancellation, reconciliation, settlement, and receipt. A blocked report fails only its assignment and the coordinator continues the frozen FIFO queue; it must not be accepted as completed work or retried as an ordinary rejection.
- Preserve uncertainty: do not dispatch after plan revisions become stale; do not repeat work on report I/O errors; do not release capacity before provider terminal facts, assignment settlement, and durable receipt validation. Keep unresolved facts in reconciliation.
- Preserve the production adapter contract: continuation waits on the same running process and frozen deadline. Do not send another prompt or extend the deadline. The coordinator must continue processing other slots and cancellation/deadline signals while any slot is waiting.
- Do not add a daemon, a second state store, Agent-driven FIFO, a host-wide hard gate, new profile options, or changes outside this Trellis repository.
- Release both packages as `0.7.1-beta.16` through the native Trellis beta release and GitHub Actions path. After both npm packages are visible at that exact version, reinstall through Pennix Lifecycle and verify the installed CLI/Core versions and bundled Teamwork assets.

## Acceptance Criteria

- [ ] F1-F8 and S1-S4 each have a code or bundled-contract change and a focused regression test, or a documented evidence-based disposition consistent with the accepted contract.
- [ ] Existing successful FIFO, capacity, retry, and normal recovery behavior still passes; blocked work settles as `SETTLED_WITH_FAILURE` while later FIFO assignments run.
- [ ] Production runtime tests prove same-process continuation, frozen deadline behavior, concurrent slot progress, cancellation observation, and terminal handling without claiming live-provider E2E coverage.
- [ ] Bundled Skill and teammate card distinguish interactive Session waits from managed batch, and state the Agent action for each terminal receipt.
- [ ] Core and CLI lint/typecheck/test/build and release preflight checks pass; the packed artifact contains the updated bundled assets.
- [ ] GitHub Actions publishes matching CLI/Core version `0.7.1-beta.16` to npm `beta`; both exact package versions are visible before installation.
- [ ] Pennix Lifecycle installs exact version `0.7.1-beta.16`; native status/check plus CLI/Core version and bundled-asset checks pass.
- [ ] The component task records delivery evidence and the root task integrates the accepted submodule gitlink only after component acceptance.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
