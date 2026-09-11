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
and the pre-existing `marketplace` modification. The source fix must pass the
full quality gate before the stable release script is run; generated `dist/`
files must come from the release build and must not be edited manually.
