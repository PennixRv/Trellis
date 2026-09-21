# Implementation Plan: Response-Gated Codex App Server Handshake

## Preconditions

1. Treat the four existing dirty files as candidate work. Record their diff and
   verify it against this task before editing; preserve unrelated changes.
2. Run GitNexus upstream impact for every symbol that may be changed. If the
   local runner is absent, restore the project-supported GitNexus entry point
   before editing and report any HIGH or CRITICAL result.
3. Read the CLI backend and unit-test specs, including the channel contract,
   error handling, quality, mock strategy, and relevant thinking guides.

## Ordered Steps

1. Trace the request-id lifecycle from request encoding through
   `parseCodexLine`, response handling, supervisor stdout processing, and
   handshake failure shutdown.
2. Review the candidate response waiter implementation for ordering, timer,
   child-exit, child-error, and late-response cleanup. Make only the changes
   needed to satisfy the PRD.
3. Verify or add tests for success ordering, initialization error, malformed
   initialization result, initialization timeout, child exit/error,
   `thread/start` error/timeout/malformed result, and successful ready state.
4. Update the channel code-spec with the executable handshake and failure
   contract. Do not document unsupported claims about worker capabilities.
5. Run targeted tests, then the repository-supported CLI lint, typecheck,
   build, full tests, and `git diff --check`.
6. Run GitNexus `detect_changes` against `main`; confirm that only the expected
   adapter response flow and its tests/contract changed. Review the final diff
   for scope and error-message quality.
7. Commit only the verified component files. Do not publish or install from the
   development shell; pass the commit and test evidence to the root audit for
   its release and fresh-host acceptance gate.

## Verification Commands

```bash
<supported-pnpm> --filter @mindfoldhq/trellis test -- channel-codex-adapter
<supported-pnpm> --filter @mindfoldhq/trellis lint
<supported-pnpm> --filter @mindfoldhq/trellis typecheck
<supported-pnpm> --filter @mindfoldhq/trellis build
<supported-pnpm> --filter @mindfoldhq/trellis test
git diff --check
```

`<supported-pnpm>` must be replaced with an installed, project-supported
package-manager entry point. A missing `pnpm` binary is an environment blocker,
not a reason to skip the required checks.

## Stop And Rollback Conditions

- Stop before commit if a response cannot be correlated with its request id,
  cleanup is not deterministic, tests still depend on elapsed wall-clock time,
  or impact analysis is HIGH/CRITICAL without a reviewed mitigation.
- Stop before release if required checks cannot be run or if the final diff
  expands permissions, capabilities, or unrelated channel behavior.
- Revert only the task-scoped component commit if a later CI or fresh-host
  check demonstrates a handshake regression; retain the failing evidence and
  leave the root worker-capability finding open.
