# Active-task resolver isolation design

## Root cause

`resolve_active_task()` currently resolves a context key, reads that key's session file, and then falls
through to `_resolve_single_session_fallback()` when the key's pointer is absent. The fallback was intended
for platforms that provide no usable identity, but it can therefore select the only foreign session pointer.
The OpenCode `TrellisContext.getActiveTask()` implementation mirrors the same unsafe fallthrough.

## Correct resolution algorithm

```text
context_key = resolve_context_key(...)

if context_key exists:
    context = read(context_key)
    task_ref = usable(context.current_task)
    if task_ref:
        return exact task, source=session:<context_key>
    return no task, source=none, context_key=<context_key>

if fallback is enabled:
    return single-session fallback, if exactly one usable session exists

return no task, source=none
```

The same branch must exist in Python and JavaScript. No caller-side guard is added because all relevant
callers already route through these shared resolvers.

## Compatibility and safety

- Exact current session pointers remain authoritative, including stale task references, which continue to be
  reported as stale rather than silently falling back.
- Identity-less single-session fallback remains available for class-2 sub-agents whose host cannot propagate
  the parent identity.
- A known identity with no pointer is an intentional unbound state, especially during formal handoff intake;
  returning no task is safer than borrowing state from another window.
- `finish` must resolve only the exact known session. It must not clear a foreign pointer merely because it is
  the sole file. Explicit archive by exact task path remains the operation that clears all pointers for an
  archived task.

## Files and ownership

| File | Reason |
| --- | --- |
| `packages/cli/src/templates/trellis/scripts/common/active_task.py` | Shipped Python resolver source |
| `.trellis/scripts/common/active_task.py` | Dogfood twin; must remain byte-identical |
| `packages/cli/src/templates/opencode/lib/trellis-context.js` | Shipped OpenCode resolver source |
| `.opencode/lib/trellis-context.js` | Dogfood OpenCode copy |
| `packages/cli/test/regression.test.ts` | Python CLI and lifecycle regression cases |
| `packages/cli/test/templates/opencode.test.ts` | OpenCode resolver regression cases |

No changes are expected in OpenViking, Pennix Skills, project hooks, or runtime state.

## Release and deployment boundary

The repository release script is the only supported release route. It synchronizes CLI/core versions, creates
the release commit and tag, pushes the branch/tag, and lets GitHub Actions publish both packages. Local
`npm publish`/`pnpm publish` is forbidden. After CI verifies public npm visibility, upgrade the global CLI with
the approved version, run the project's native update path, and record the resulting version in
`/home/penn/.codex/pennix-docs/` without copying runtime state.
