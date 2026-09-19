# Design: Unbound Active-Task Projection

## Behavior

The session pointer remains the only writable binding. A read-only projection is
allowed only for recovery-oriented display when the shell has no identity and
the repository has exactly one resumable task assigned to the local developer.
The projection is labeled `unbound`, so callers can distinguish it from both a
direct `session:<key>` binding and the legacy `session-fallback:<key>` case.

Resolution order:

1. Resolve a direct context key and return its exact pointer, or return `none`
   when that known key has no pointer.
2. Without a context key, retain the existing single-session-file fallback.
3. Only when there are no session files, resolve one assigned task whose status
   is `planning`, `in_progress`, or `review` as `unbound`.
4. Return `none` for zero or multiple candidates.

The unbound result is exposed to read-oriented context consumers. Existing
mutation paths continue to request a direct session and therefore cannot finish,
handoff, or mutate ownership from an unbound result.

## Data Flow

```text
task.json + .developer
        -> active-task resolver (source=unbound, no pointer write)
        -> task.py current / session context / workflow hook
        -> [workflow-state:unbound_task]
```

The CCH status bar remains an independent aggregate of task statuses. It is
evidence that a task exists, not a session binding and not a replacement for the
resolver.

## Compatibility

The Python template and `.trellis/scripts` dogfood copy remain byte-identical.
The OpenCode context resolver mirrors the same candidate rule. Existing direct
session, foreign-session isolation, and identity-less single-session fallback
contracts remain unchanged.
