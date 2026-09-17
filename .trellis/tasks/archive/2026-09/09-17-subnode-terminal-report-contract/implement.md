# Implementation Plan

1. Add reducer regressions for normal subnode completion, cleanup preservation,
   and an incomplete subnode kill.
2. Add a completion-only supervisor shutdown path and invoke it after the
   persisted `done` / `turn_finished` sequence for `agent: subnode`.
3. Update the subnode role card and the bundled coordinator procedure to use
   the final assistant reply instead of `trellis channel send`.
4. Add focused CLI regression coverage for the stdout completion callback and
   shutdown event behavior.
5. Run package tests, lint, typecheck, template packaging smoke checks, then
   release the patch from `main` through the existing CI-only release command.

## Validation

```bash
pnpm --filter @pennixrv/trellis-core test
pnpm --filter @pennixrv/trellis test
pnpm lint
pnpm typecheck
node packages/cli/scripts/release-preflight.js check-versions
node packages/cli/scripts/release-preflight.js verify-packed-cli
```

## Explicit Non-Changes

- Do not alter CCH source or configuration.
- Do not add a sandbox flag, scheduler, retry framework, worktree, or event kind.
- Do not change generic worker lifecycle behavior.
