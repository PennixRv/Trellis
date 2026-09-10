# Minimize subnode artifact protocol

## Goal

Remove unneeded mandatory null relation fields and permit early terminal reports without weakening task-owned artifact, evidence, and coordinator-review contracts.

## Requirements

- Keep Trellis's native `trellis workflow --create-new` behavior unchanged. This
  task must not create a Pennix migration or merge mechanism around it.
- An ordinary subnode brief must not need `retry_of: null` or
  `counter_of: null`. When either relation is supplied, retain the existing
  validation for a real retry or counterwork.
- A `blocked`, `incomplete`, or `error` report must retain the
  `completed_scope` field, but an error before work begins may report an empty
  list. Its blocker remains required.
- The selected Codex workflow must say that native event waiting is preferred
  and high-frequency polling is prohibited; it must not prohibit all on-demand
  post-wait diagnosis or status queries.
- Preserve artifact containment, secret/size bounds, task identity, evidence,
  counter independence, coordinator-only acceptance, and the existing Channel
  lifecycle. Keep the two shipped Python script trees byte-identical.
- Publish the Marketplace workflow and Trellis package together at the next
  matching release version. Update the Pennix setup source pin only after that
  Marketplace tag exists.

## Acceptance Criteria

- [x] A brief with no retry/counter relation creates and validates normally.
- [x] A supplied retry or counter relation still receives the current
      relationship checks.
- [x] A non-complete report with `completed_scope: []` and a blocker validates;
      a missing `completed_scope` or blocker does not.
- [x] The Marketplace workflow expresses event-driven waiting without the
      absolute `Do not poll` prohibition.
- [x] Targeted integration tests, script-tree parity, lint, typecheck, and the
      applicable release checks pass.
- [x] No Channel event schema, native workflow switch behavior, Hook, user
      Skill, scheduler, retry automation, manifest, or sandbox rule is added.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

## Verification

- Script-tree parity and targeted CLI integration tests passed (2 files, 34 tests).
- `pnpm lint`, `pnpm typecheck`, and the full suite passed: core 377 tests
  (1 skipped), CLI 1,933 tests.
- Release preflight and packed CLI dependency checks passed before and after the
  synchronized bump. `v0.6.23` was pushed to `main`; npm CI and CI both
  completed successfully, with `@pennixrv/trellis` and
  `@pennixrv/trellis-core` published as `0.6.23`.
- Marketplace `v0.6.23` is `4c3b0715da929b70752301127e0fb7c2a13b4600`.
