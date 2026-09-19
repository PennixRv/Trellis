# Implementation: Unbound Active-Task Projection

1. Add the read-only `unbound` candidate resolver to both Python script copies.
2. Add `unbound_task` workflow breadcrumb to template and dogfood workflow files.
3. Route the shared workflow hook to `unbound_task` without task-creation guidance.
4. Mirror the candidate resolution in the OpenCode context template.
5. Add regression coverage for unique, ambiguous, known-session, and mutation boundaries.
6. Run focused Python/Node tests, parity checks, full CLI quality gates, and release preflight.
7. Record release and installation evidence, then finish/archive the task normally.
