---
name: trellis-teamwork
description: Use Trellis Teamwork for fixed teammate batches, durable Channel collaboration and forums, one-shot questions, and runtime diagnostics.
---

# Trellis Teamwork

The public command is `trellis teamwork`. It manages Teamwork sessions and teammate processes over the existing Core Channel event, API, and storage contracts.

Use this Skill when coordinating a fixed set of independent teammate assignments, running one bounded question, working with a durable forum/thread, or diagnosing Teamwork runtime state.

## Choose the route

- For independent work units with a shared terminal receipt, read `references/workflows.md` and `references/teammates.md`, then prepare one complete batch plan. Submit it once with `trellis teamwork batch <plan>`. The CLI currently fails closed before writing coordination state when no verified host adapter is installed. Do not replace that route with manual per-teammate dispatch.
- For one bounded question, use `trellis teamwork run`; see `references/teammate-processes.md`.
- For durable discussion or issue tracking, use a forum channel and its threads; see `references/forum.md`.
- For the public command syntax, load `references/command-reference.md`.
- For two independent evaluations of one frozen contract, load `references/independent-evaluation.md`.
- For runtime state and failure diagnosis, load `references/progress-debugging.md`.

## Batch boundary

Before submitting, read the active Trellis task, its closed plan, applicable specs, and the generic role card at `.trellis/agents/teammate.md`. Freeze every work unit's objective, source scope, evidence, output path, acceptance criteria, teammate identity/profile, and bounded retry policy in the plan.

After submission, the program owns slot assignment, FIFO refill, waiting, retry classification, artifact checks, and the terminal receipt. The coordinating agent waits for that receipt and does not inspect partial teammate results or take over batch scheduling. Only after a terminal receipt may it evaluate reports, reconcile failed work, or continue the task's normal review and completion process.

Teammates use the one generic role contract. They investigate, research, review, verify, and write their assigned evidence/report; they do not implement product code or use a platform's native nested-agent mechanism. A committee is a fixed pair of independent evaluations, not teammate-to-teammate discussion.

## Implementation Completion

After the batch reaches a terminal receipt, continue the owning Trellis task through its normal implementation and completion gates. Compare the resulting changes with the task PRD, design, execution plan, and applicable specs. Match review and tests to change risk; add cases for uncovered behavior, fix findings, and rerun affected checks. Record completed plan steps, changed paths, verification, and the next action in `execution.md`. Never edit `task.json` status by hand; use the native task lifecycle commands, and keep the task `in_progress` until its acceptance gates pass. Use `trellis task progress [--json]` for a read-only summary of lifecycle counts; it does not update task state.

## References

- `references/command-reference.md` — complete public CLI syntax.
- `references/workflows.md` — batch preparation and route selection.
- `references/teammate-processes.md` — teammate profiles, runtime, and one-shot work.
- `references/teammates.md` — batch artifacts and report contract.
- `references/independent-evaluation.md` — advisor and two-member committee contract.
- `references/forum.md` — durable forum and thread use.
- `references/progress-debugging.md` — runtime diagnostics.
