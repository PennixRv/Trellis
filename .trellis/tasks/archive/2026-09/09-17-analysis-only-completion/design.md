# Analysis-Only Delivery Design

## Decision

Use the existing extensible `task.json.meta` field with the exact value
`delivery_mode = "analysis_only"`. The mode is a task-level declaration, not a
new lifecycle status and not a title heuristic.

## Eligibility and Boundary

The task PRD must define an evidence, audit, research, or design deliverable
and explicitly exclude product source, runtime configuration, deployment,
credentials, and external-system writes. Task artifacts, research reports,
commits, and archive bookkeeping remain allowed.

If a conclusion requires a protected-target change, the analysis task records
the evidence and recommendation, then stops or creates a separate
change-bearing task. The mode never authorizes that change.

## Lifecycle

```text
task-creation consent
  -> create task with meta.delivery_mode=analysis_only
  -> record a bounded PRD
  -> perform the declared evidence work while status=planning
  -> verify acceptance evidence and the no-change boundary
  -> commit task artifacts and archive directly
```

`task.py start` is intentionally absent: it transitions to the code-oriented
`in_progress` path and can require implementation/check context manifests.
`task.py archive` already records completion and clears active task pointers,
so no task-script or status-writer change is required.

## Template Synchronization

The native workflow template is the semantic source of truth. Common
start/brainstorm/continue/finish-work templates are entry points and must use
the same exact metadata condition. Template tests assert all of those texts;
no generated project copy is edited.

## Risks

- A title-based heuristic could classify a task that later writes code. The
  exact metadata value plus PRD boundary prevents that.
- A broad exception could weaken implementation consent. The rule names the
  exception as evidence-only and requires a separate task for any change.
- A new lifecycle status would require hook, continuation, and UI routing
  changes. Reusing `planning` avoids that unsupported state surface.
