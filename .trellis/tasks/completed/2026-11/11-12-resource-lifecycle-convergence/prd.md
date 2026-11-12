# Resource lifecycle convergence: task and Teamwork

## Goal

Implement approved root workflow-resource-lifecycle-convergence W1/W2: task runtime boundaries, historical diagnostics, Teamwork evidence safety, native cleanup and generated asset propagation.

## Requirements and approved source

Implement W1/W2 of the root task `workflow-resource-lifecycle-convergence`.
The root accepted contract revision is
`6b8d38953a76bf85650dc8b5a1af8f5f71002c91fa8a237d03b6af187c5b6453`.
Its `solution-design.md` and `implementation-contract.md` are the authoritative
scope and detailed design. The root task is under the parent repository's
`.trellis/tasks/in_progress/11-12-workflow-resource-lifecycle-convergence/`.

The user approved continued implementation after the complete proposal:
“现在完整推进到任务停止点”. Root Task CLI has separately accepted the contract
and recorded implementation authorization. This owner task inherits that
bounded approval; it does not reopen the accepted requirements or choices.

## Acceptance Criteria

- Task context excludes terminal records while historical inspection remains available.
- Native runtime previews and exact confirmation handle only proven retired
  task projections, markers and locks; fixed synchronization, CAS, authority,
  atomic writes and recovery remain effective.
- Teamwork diagnostics share frozen attempt identity and cleanup boundaries;
  evidence dependencies, reservations and unknown process exits remain protected.
- Wait release removes empty shells under the existing guard; safe diagnosis
  and recovery remain reachable without relaxing FIFO or dispatch fences.
- Changed Python templates and dogfood assets remain identical through the
  native generated-asset owner; required source, packaging and regression gates pass.
- Publish the fixed three-package release, leaving real data disposal to the
  root's fresh, separately approved native previews.

## Modification and recovery boundary

Change CLI commands, shipped Python/Hook templates, native ignore rules,
bundled instructions, tests, relevant specs and release metadata. Preserve
unrelated work and all real task/session/handoff history. Do not add a global
collector, daemon, dependency, resource registry or another authority record.
Root owns cross-component integration and installing the accepted release.

## 验收覆盖

| 接受条件 | 工作包 | Owner | 验证入口 | 交付证据 | 停止条件 |
| --- | --- | --- | --- | --- | --- |
| Task lifecycle and synchronization remain valid | W1 | Trellis CLI/templates | task workflow/layout/context/delegation regressions | execution.md and test results | CAS, authority, recovery or atomicity regression |
| Native runtime exits are bounded and reviewed | W1 | Trellis Task CLI | runtime preview/confirm and concurrency tests | execution.md and structured previews | Unknown owner/content, stale digest or unsafe anchor |
| Teamwork diagnostics and evidence cleanup are coherent | W2 | Trellis Teamwork | cleanup/result/reservation/runtime/lock tests | execution.md and test results | Useful evidence, unresolved process exit or unsafe paths |
| Wait diagnosis and recovery are reachable | W2 | Trellis Teamwork/Hook | foreground-wait/guard regressions | execution.md and test results | FIFO/dispatch protection lost or safe recovery blocked |
| Fixed release is reproducible and verified | W4 | Trellis release owner | lint, typecheck, lint:py, test, build, release checks and packed CLI | source/package/version/provenance evidence | Inconsistent package versions, failed required gates or artifact mismatch |
