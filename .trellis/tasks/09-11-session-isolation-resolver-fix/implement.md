# Implementation plan

This task is intentionally small and must be completed before the Continuation Record task proceeds.

1. Re-read this task, `AGENTS.md`, the shared guides, CLI backend/unit-test specs, filesystem safety,
   workflow-state contract, and release process. Confirm the current branch/release state and protect
   unrelated worktree changes.
2. Refresh GitNexus with the supported command. Run upstream impact for the Python resolver and the OpenCode
   resolver. Resolve any `HIGH`, `CRITICAL`, or `UNKNOWN` result with graph/text evidence before editing.
3. Patch the two Python resolver copies with the single guard: known context key with no usable pointer
   returns no task; only absent context identity enters single-session fallback.
4. Patch the two OpenCode resolver copies with the identical semantic guard. Keep generated `dist` output
   out of manual edits.
5. Add non-tautological regression coverage for known-key/foreign-pointer isolation, empty/malformed pointer,
   exact current pointer, identity-less fallback, and `finish` non-deletion of a foreign pointer. Verify the
   workflow-state hook and OpenCode consumer paths.
6. Run Python/template parity, focused tests, full lint, typecheck, build, full tests, `trellis-check`, and
   GitNexus `detect-changes`. Fix failures at the shared resolver or stop; do not add caller workarounds.
7. Run release preflight and packed artifact checks. Confirm the paired core/CLI version contract, branch
   policy, manifest continuity, and that `.trellis/` task files are excluded from release staging.
8. Use the official repository release command to commit/version/tag/push. Wait for GitHub Actions to publish
   and verify both packages on public npm. Do not publish locally.
9. Upgrade global `@pennixrv/trellis` to the verified published version, run the native project update flow,
   and smoke-test a fresh temporary project plus this project. Record installed version/source and rollback
   version in the host static docs only after deployment succeeds.
10. Run final status/diff review, archive this exact task only after all acceptance criteria pass, and report
    the release tag, package versions, installed version, tests, and known limitations to the root task.

## Stop conditions

- Any resolver copy drifts from its required twin.
- A known target identity still resolves a foreign pointer.
- A regression or quality gate fails.
- Release preflight, CI publication, npm visibility, or packed dependency verification fails.
- Any step would require modifying OpenViking, context-mode, secrets, runtime state, or unrelated user changes.
