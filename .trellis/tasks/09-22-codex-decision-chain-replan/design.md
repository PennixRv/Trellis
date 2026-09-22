# Technical Design

## Boundaries

Trellis owns the task lifecycle transition and the memory phase boundaries. Pennix Skills owns the decision-gate protocol and its native-question fallback. The bridge is textual workflow guidance plus the durable `task.py replan` event; it does not import or copy a Pennix runtime.

## Replan lifecycle

```text
in_progress
    │ task.py replan <task> <reason>
    ├─ validate task ownership, status, and non-empty reason
    ├─ append .trellis/tasks/<task>/replans.jsonl atomically/append-only
    ├─ write task.json status=planning atomically
    └─ run hooks.after_replan (fail-open)
planning
    │ decision-gates / brainstorm resolves the new frontier
    └─ task.py start <task> → in_progress
```

The session pointer and task branch are not changed by `replan`. The event contains the timestamp, task path, prior status, reason, current branch, and session identity when available. A failed append prevents the status transition.

## Memory slicing

`TaskPyEvent` gains `replan`, with an optional reason only at the script boundary. `buildBrainstormWindows` treats every `create` or `replan` as a planning-open event and pairs it with the next matching `start`; matching uses slug first and FIFO fallback. Unmatched planning events extend to `totalTurns`; unmatched starts retain the existing `[0,start)` fallback. The public `MemExtractResult` shape remains unchanged.

## Template and hook projection

The common brainstorm skill describes evidence inventory and optional batch delegation. The Copilot prompt mirrors the contract. Workflow and continue documents define `decision-needed`, `replan`, and the fresh-approval boundary. Both generated task script trees remain byte-equivalent. `config.yaml` and `trellis-meta` document the optional fail-open hook.

## Compatibility and rollback

- Existing `create`/`start` parsing and windows remain valid.
- Tasks created before this release have no `replans.jsonl` and continue unchanged.
- If replan validation or event persistence fails, `task.json` remains untouched.
- If Core or package validation fails, do not publish or update the root catalog; the beta branch remains at the last published commit.
