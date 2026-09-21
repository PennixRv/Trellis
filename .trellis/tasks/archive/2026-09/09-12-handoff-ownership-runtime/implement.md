# Implementation plan

1. Extend the existing continuation runtime with a bounded ownership record, validator, path helper,
   lock, digest, and atomic-write helpers. Mirror every Python change into the template tree.
2. Add `task.py ownership` handlers for `quiesce`, `retire`, `claim`, `consume`, `archive`, and `status`;
   keep ordinary task lifecycle handlers untouched.
3. Make retirement and claim direct-session-only. Use the existing active-task writer for target binding
   and verify the resulting direct context before finalizing the record.
4. Add tests for valid lifecycle, invalid transitions, stale fencing, simultaneous claims, target-without-
   pointer isolation, same-consumer retry, cross-consumer refusal, pointer drift, unsafe paths, and secrets.
5. Run focused/full tests, lint, typecheck, Python checks, build, release preflight, and template parity.
6. Commit, publish both packages in lockstep, align the marketplace tag, install the published version, and
   verify the installed CLI. Stop before Pennix deployment if any check fails.

## Rollback

The runtime is additive and Git-revertible. Do not delete live runtime records during rollback. Keep the
existing continuation and ordinary task lifecycle available.
