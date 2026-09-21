# Implementation Plan

1. Add the Codex owner preflight to the shared `channelSpawn` entry point.
   - Read the durable create event through the existing CLI event reader.
   - Reject before any guard, lock, reservation, config write, or fork.
2. Add `ownerSession` to `RunOptions`, register `channel run --owner-session`,
   and forward it into `createChannel`.
3. Add focused regressions:
   - ownerless direct Codex spawn rejects with no worker side effect;
   - `channel run` writes its supplied owner before invoking spawn.
4. Run the focused tests, then full lint, type-check, build, and test suite.
5. Run `git diff`, GitNexus change detection, and the task/spec review.
6. Commit only the task-owned source, tests, and specification changes.
7. Use the documented `pnpm release` path from `main`; verify CI/npm package
   visibility, reinstall the global CLI, and smoke-test the released behavior.

## Rollback checkpoint

Before release, reverting the owner-preflight diff restores previous behavior.
After release, issue a follow-up patch release rather than mutating the tag.
