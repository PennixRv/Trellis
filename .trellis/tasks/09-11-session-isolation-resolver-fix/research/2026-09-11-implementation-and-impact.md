# Implementation and Impact Record

## Verified root cause

`resolve_active_task()` resolved a known context key, then fell through to
`_resolve_single_session_fallback()` when that key's runtime file was missing,
empty, or malformed. A new session could therefore inherit the only task
pointer belonging to an older session. The same policy was present in the
OpenCode `TrellisContext` resolver.

The OpenCode `inject-subagent-context.js` hook contained a separate fallback
path after exact lookup and prompt-hint lookup. It also needed the same
known-identity guard; changing only `TrellisContext.getActiveTask()` would not
fix subagent prompt injection.

## Change boundary

- Python dogfood and shipped template resolver copies now treat a known
  context key as authoritative and return `ActiveTask(None, "none", key)` when
  its own pointer is unavailable.
- OpenCode dogfood and shipped template resolver copies apply the equivalent
  policy.
- OpenCode subagent injection retains the explicit `Active task:` prompt hint,
  but only permits implicit single-session fallback when no identity exists.
- No OpenViking, context-mode, or unrelated Trellis component was changed.

## Impact evidence

GitNexus `detect-changes --scope all` reported critical risk, 8 changed files,
6 symbols, and 36 affected execution flows. The shared resolver is used by
task discovery, path resolution, current-task reporting, cleanup, and hook
injection, so the fix is intentionally made at the shared policy boundary.

## Verification

- Python regression matrix: missing, empty, and malformed known-session
  pointers do not borrow a sole foreign session.
- Codex workflow-state hook: a known session with a foreign sole pointer emits
  `Status: no_task` and does not expose the foreign task.
- OpenCode resolver: no-identity fallback remains available; a known missing
  session does not borrow the sole foreign pointer.
- OpenCode subagent injection: no-identity fallback remains available; a
  known missing session leaves the prompt untouched; an explicit task hint
  remains usable.
- Focused tests passed: `test/templates/opencode.test.ts` (75/75) and the
  `session-isolation` regression selection (3/3).

## Release/deployment gate

The source checkout was safely fast-forwarded from detached `HEAD` to local
`main` at the existing user-owned `890196e1` line, preserving its two commits
and the pre-existing `marketplace` Gitlink. The source fix passed the full
serial quality gate before the stable release script was run; generated `dist/`
files must come from the release build and must not be edited manually.

The release script correctly rejected the first attempt before it created a
release commit, tag, or push: npm already contains `@pennixrv/trellis@0.6.24`,
but both its tarball and this source line lacked `0.6.24.json`. The published
v0.6.24 task records establish that it was the non-migrating semantic
RecoveryBrief/formal-handoff Marketplace release. This repository therefore
backfills the matching non-migrating manifest; the continuity gate is not
bypassed.

Marketplace is a Git workflow registry, not an npm package. Its `index.json`
`version` remains registry schema version `1`. For the coordinated v0.6.25
release, the clean Marketplace `8ff6829` source commit is retained and receives
an immutable `v0.6.25` compatibility tag before the parent Trellis v0.6.25
release. The parent Gitlink already pins that exact commit, so no unrelated
Marketplace asset change is justified.
