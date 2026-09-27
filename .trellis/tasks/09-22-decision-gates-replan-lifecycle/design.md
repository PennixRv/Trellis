# Decision Gates And Replan Design

## Authority Split

`pennix-decision-gates` owns the decision graph and Codex-native interaction
contract. Trellis owns task lifecycle, PRD convergence, final implementation
approval and the optional capability bridge. Generic Trellis templates do not
import Pennix runtime code or duplicate its graph schema.

## Lifecycle

```text
in_progress -- decision-needed --> replan --reason --> planning
planning -- sealed graph + fresh approval --> start --> in_progress
```

`replan` first appends an audit record, then writes `planning` while preserving
the existing task pointer and branch, and finally runs fail-open `after_replan`.
It performs no Git restoration itself.

## Memory And Migration

Core maps `create` and `replan` to planning-window starts and pairs each with the
next matching `start`. Existing template update hash behavior remains the
migration mechanism; this task adds coverage rather than a new updater.

## Explicit Non-Goals

- No Pennix hard dependency for ordinary Trellis installations.
- No new task status, global state, background service or database.
- No destructive update of user-modified generated files.
