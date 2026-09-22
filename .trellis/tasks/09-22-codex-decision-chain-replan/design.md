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

## Planning, evidence, and subnode projection

The common brainstorm skill and Copilot prompt distinguish a bounded evidence-only task from any complex analysis that still needs a material decision, plan, cross-owner action, security/deployment/release/credential action, or downstream change. Returned native answers are immediately recorded and continue the same decision chain.

Every read-heavy unit persists one bounded question/scope, minimal evidence range, destination, stop condition, conclusion or blocker, unknowns, and recovery point. This applies to the coordinator and any explicit independent-evidence subnode; ordinary navigation remains artifact-free.

Before `task.py start`, the Planning Seal reconciles task metadata, all planning artifacts, decisions and manifests, then locks source targets/branches, dependency/release ordering, validation/rollback, dynamic-fact dispositions/replan triggers, and every material decision. Static ambiguity returns the task to planning.

Subnode reports use schema v2. They bind each brief scope item to a `covered`, `inconclusive`, or `not-started` assessment, structured evidence-linked findings, typed uncertainty/correction notes, and worklog checkpoint markers. Identity/schema/path violations fail; incomplete checkpoint or coverage evidence yields `review_concern` for the coordinator, never an acceptance decision. Both generated task script trees remain byte-equivalent. `config.yaml` and `trellis-meta` document the optional fail-open hook.

## Compatibility and rollback

- Existing `create`/`start` parsing and windows remain valid.
- Tasks created before this release have no `replans.jsonl` and continue unchanged.
- If replan validation or event persistence fails, `task.json` remains untouched.
- If Core or package validation fails, do not publish or update the root catalog; the beta branch remains at the last published commit.
