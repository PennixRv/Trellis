# Handoff ownership fencing and rename safety

## Goal

Resolve F-007 and F-011 from the root coordination task
`codex-workflow-optimization/.trellis/tasks/10-20-audit-residual-convergence`.
This is the Trellis source-maintenance part of that delivery.

## Requirements

- Maintain this work on `pennix/v0.7-beta`, tracking `origin/pennix/v0.7-beta`.
  Both task branch fields must name that branch. Stable `main` is outside scope.
- Locate ownership records with the canonical ID in the current task JSON,
  including tasks whose directory carries the native creation-date prefix.
- Preserve native session, integrity, path and consumer checks; malformed task
  identity or unsafe record locations must not silently bypass fencing.
- Reject native task rename before writes whenever the task has formal handoff
  ownership records. The user chose refusal for consumers as well as outsiders;
  record migration and handoff-identity changes are outside scope.
- Preserve ordinary task rename behavior when no handoff record exists.
- Keep marketplace content and its current gitlink unchanged. These fixes affect
  shared Python scripts, not workflow marketplace assets. Any newly required
  marketplace edit needs an explicit target/branch decision and revised plan.

## Acceptance Criteria

- [ ] Native date-prefixed task fixtures enforce fencing for non-consumers and
  missing identities; valid consumers retain supported lifecycle operations.
- [ ] Rename with handoff records fails with task, references, session pointers
  and records unchanged; ordinary rename still succeeds.
- [ ] Applicable ownership states and malformed/unsafe inputs have regressions.
- [ ] Shipped and dogfood Python trees remain byte-identical; Python compatibility,
  lint, typecheck, tests, build and packed-asset checks pass.
- [ ] Both packages are released together to beta from `pennix/v0.7-beta` through
  CI; root records exact source, artifact, native installation and project-update
  evidence before this source task is accepted.
- [ ] After native archive/journal and all task commits, the maintenance HEAD
  equals the live `origin/pennix/v0.7-beta` tip with no ahead/behind or omitted
  in-scope files. Root pins that final HEAD separately from the release tag.

## Authorization

Planning only. The root task's original request and the two design answers are
not implementation approval. Present this exact source plan with the root plan,
then record explicit approval of both before native seal/approve/start.
