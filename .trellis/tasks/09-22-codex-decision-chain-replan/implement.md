# Implementation Plan

## Phase A: lifecycle and templates

- [x] Add `task.py replan` parser, validation, append-only event persistence, status transition, and hook dispatch.
- [x] Add `after_replan` documentation/config handling without changing fail-open hook semantics.
- [x] Update common/Copilot brainstorm, workflow, continue, and Trellis metadata guidance.
- [x] Synchronize the two generated task script trees and add Python regression coverage.

## Phase B: Core phase slicing

- [x] Extend Core types and `phase.ts` parser/window logic for `replan`.
- [x] Add phase tests for repeated replans, quoted commands, unmatched events, and historical behavior.
- [x] Update session-insight quick reference and relevant adapter-facing tests.

## Phase C: verification and release

- [x] Run focused Python and Core tests, then relevant package checks.
- [x] Run `node .gitnexus/run.cjs detect-changes --scope all --repo .` and inspect every changed symbol.
- [x] Run Trellis update/template projection checks and full applicable tests.
- [ ] Commit and push only `pennix/v0.7-beta`; publish the beta packages from that branch; install and verify locally. Marketplace beta commit: `3b8410c`; docs release asset commit: `8542a4b`.
- [ ] Record the exact beta commit/version in the root task evidence; do not backport to stable.

## Validation commands

```bash
python3 -m unittest discover -s .trellis/tests -p 'test_*.py'
pnpm --filter @pennixrv/trellis-core test -- phase
pnpm --filter @pennixrv/trellis test
node .gitnexus/run.cjs detect-changes --scope all --repo .
```

## Rollback points

- Any event persistence or lifecycle regression blocks publication.
- Any template projection mismatch blocks publication.
- Any Core phase mismatch blocks publication.
- A failed package publish does not trigger repeated monitoring; fix only after the complete provider error is captured.
