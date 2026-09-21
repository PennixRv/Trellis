# Fail closed for unowned Codex Channel workers

## Goal

Prevent Codex Channel workers created without a resolvable owner session from running invisibly to owner-scoped consumers such as CCH. Require an explicit owner session or Codex session environment identity when spawning Codex workers, preserve non-Codex Channel compatibility, add regression coverage, release, and verify the installed CLI.

## Requirements

- A Channel that will spawn a `codex` worker must have a non-empty immutable
  `ownerSessionId` on its `create` event before any worker-side effect begins.
- Preserve the existing owner resolution order: explicit `--owner-session`,
  then `CODEX_THREAD_ID`, then the legacy `CODEX_SESSION_ID` fallback.
- Keep ownerless Channels valid for non-Codex providers and for non-worker
  channel use.
- Make `channel run` accept and forward `--owner-session` when it creates its
  ephemeral Channel.
- Do not derive a CCH owner from `TRELLIS_CONTEXT_ID`, do not invent a session
  identifier, and do not relax CCH's exact owner filtering.
- Release the version-locked CLI/core package pair through the documented CI
  release path, then reinstall and smoke-test the released CLI locally.

## Acceptance Criteria

- [ ] An ownerless Channel rejects `channel spawn --provider codex` before a
  supervisor, reservation, or worker process is created, with an actionable
  owner-session error.
- [ ] Explicit owner and existing Codex host-environment owner behavior remain
  unchanged.
- [ ] An ownerless non-Codex Channel is not rejected by the new Codex-only
  validation.
- [ ] `channel run --owner-session <id>` persists `<id>` in its generated
  Channel create event before it delegates to spawn.
- [ ] Regression tests, lint, type-check, build, and the relevant CLI tests
  pass.
- [ ] The release tag reaches CI, both npm packages are visible at the same
  version, and the globally installed `trellis` reports that version.

## Notes

- The original incident was launched through FastCtx, which did not expose a
  Codex session environment variable. Forwarding the real host session through
  that boundary is a separate host-integration concern; this task prevents the
  silent invisible worker until it is available.
