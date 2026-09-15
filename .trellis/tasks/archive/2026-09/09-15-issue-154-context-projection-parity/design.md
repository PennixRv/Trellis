# Design: Shared Python Context Projection

## Scope

This task fixes the Python projection used by the current Codex `SubagentStart` path and the shared Python Hook
platforms. Pi and OMP use separate TypeScript renderers with different source ordering and contracts. They are not
called by this path and are explicitly not validated by `task.py validate` after this change.

Formal session handoff is also outside this component: receipt-gated full handoff consumption is a Pennix skill
lifecycle, while this evaluator only handles ordinary `implement.jsonl` / `check.jsonl` subnode context.

## Model

`common.context_projection` owns a deterministic role projection:

```text
manifest parser (file | path)
  -> safe project/archived-task path resolution
  -> direct file or sorted first-20 Markdown directory expansion
  -> binary and UTF-8-safe per-source materialization
  -> role-local total budget
  -> task artifacts in current Hook order
  -> rendered prompt text + structured completeness issues
```

The renderer preserves the current Hook's strings and source order. Alongside every rendered block it records a
structured issue when the original material is not fully represented: file/artifact cap, binary, unavailable/escaped
path, directory empty/over-limit, or total-budget fallback. A source can be rendered as an existing notice and still be
an issue: notices are useful at runtime but do not satisfy `validate`.

`task_context.py` keeps CLI-specific formatting, placeholder/invalid-JSON reporting, seed-only gating, and code-file
hygiene warnings. It asks the evaluator for parsed entries and the role projection, then turns each completeness issue
into a non-zero diagnostic including `role`, `source`, `path`, and `reason`. The Hook asks the same evaluator for the
text only. There is no parallel byte-size approximation.

## Failure Policy

- Missing JSONL is still skipped for platforms where the manifest is not installed.
- A present but seed-only manifest remains the existing error.
- Existing, normal text under all limits is complete.
- `0` retains unlimited behavior for the corresponding individual or total limit.
- A directory is a declaration of every direct Markdown child: zero children or more than 20 children is incomplete.
  The operator must use a narrower directory or explicit small entries.
- A missing optional task artifact remains omitted exactly as today; an existing artifact that cannot be represented in
  full fails the role that would inject it.

## Test Design

Run the real stamped `task.py` and import the real shared Hook against temporary repositories. Each negative fixture
asserts the Hook emits the known degraded notice and `task.py validate` rejects the same role projection. Positive
fixtures assert the Hook has full content and validation passes. This catches drift in either direction.
