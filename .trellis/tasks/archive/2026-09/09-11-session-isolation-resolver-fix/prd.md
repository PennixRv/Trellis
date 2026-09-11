# Repair cross-session active-task fallback isolation

## Goal

Prevent Trellis from projecting a source session's task into a different target session when the target
session identity is known but has not yet created its own task pointer. Preserve the existing fallback needed
by identity-less class-2 sub-agents.

## Requirements

### R1. Resolver boundary

- If `resolve_context_key()` returns a context key, inspect only that key's session file.
- If that file is missing, malformed, empty, or has no usable `current_task`, return no active task with the
  resolved key and do not call single-session fallback.
- Call `_resolve_single_session_fallback()` only when no context key can be resolved at all.
- Preserve exact matching behavior and `source=session:<context-key>` for a valid current pointer.
- Preserve `source=session-fallback:<sole-key>` only for the identity-less, exactly-one-session compatibility path.

### R2. Distribution parity

Apply the same behavior to every shipped or dogfood implementation of the resolver:

- `.trellis/scripts/common/active_task.py`
- `packages/cli/src/templates/trellis/scripts/common/active_task.py`
- `packages/cli/src/templates/opencode/lib/trellis-context.js`
- `.opencode/lib/trellis-context.js`

Generated `packages/cli/dist/**` output must be produced by the build and must not be hand-edited.

### R3. Lifecycle safety

- `task.py current`, `task.py finish`, workflow-state injection, OpenCode context, and sub-agent context must
  not treat a foreign fallback pointer as the current target task when a target identity is known.
- A formal handoff target may use `session-fallback` only as an explicit degraded observation, never as direct
  target binding evidence. This task changes Trellis resolution only; Pennix handoff policy remains in its own
  task.
- Do not modify OpenViking, context-mode, handoff core, task JSON manually, or introduce a second task/session
  state machine.

## Acceptance criteria

- [ ] Known target key + no target pointer + exactly one foreign pointer returns no task and source `none`.
- [ ] Known target key + empty or malformed target pointer + exactly one foreign pointer returns no task.
- [ ] Known target key + valid matching pointer returns the matching task with `session:<target-key>`.
- [ ] No resolvable identity + exactly one pointer preserves `session-fallback:<sole-key>`.
- [ ] No resolvable identity + zero or multiple pointers still refuses to guess.
- [ ] Workflow-state hook and OpenCode context do not inject the foreign task in the known-key cases.
- [ ] `finish` with a known target key does not delete a foreign source pointer; identity-less fallback behavior
  remains covered by its existing compatibility test.
- [ ] Python/template byte parity, lint, typecheck, tests, package build, release preflight and packed artifact
  checks pass.
- [ ] The paired CLI/core release is pushed through the repository's official release workflow; the global
  Trellis installation is upgraded only after public npm visibility is verified.
- [ ] A fresh project smoke test confirms the released CLI produces the corrected resolver behavior after
  `trellis update`; rollback to the previous published version remains possible.

## Out of scope

- Continuation Record implementation beyond the resolver prerequisite.
- Pennix handoff lifecycle receipts or target admission implementation.
- OpenViking/NAS/Plugin changes, `context-mode` changes, FastCtx migration, or real remote data operations.
- Changes to `task.json` state as a workaround or deletion of unrelated runtime session files.
