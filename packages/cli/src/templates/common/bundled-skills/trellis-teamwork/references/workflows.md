# Teamwork workflows

Teamwork provides bounded teammate coordination through the existing event log. It is not a Trellis task workflow. Use the active task's existing plan and task-status lifecycle.

## Fixed batch

Use one batch when the work can be split into independent evidence units with explicit report destinations and acceptance criteria. Do not batch dependent steps, overlapping source edits, or work that needs teammates to coordinate directly.

1. Read `.trellis/workflow.md`, the active task's closed plan and current checkpoint, relevant specs, and `.trellis/agents/teammate.md`.
2. Define the complete work set before dispatch. For every unit, record its objective, read scope, allowed report writes, acceptance criteria, identity/profile, timeout behavior, and bounded retry limit. Keep source and Git actions read-only for teammates.
3. For a committee, define one shared question and acceptance contract, then assign exactly two distinct evaluation lenses. Their evidence must be independent. See `independent-evaluation.md`.
4. Validate the plan and submit it once with `trellis teamwork batch <plan>`.
5. Wait for the program's terminal receipt. Do not inspect partial reports, manually refill slots, retry a unit yourself, or issue per-teammate follow-up while the batch is active.
6. After the receipt, review the accepted reports against the task plan. Resolve terminal failures through the parent task, then continue the native task's risk-scaled review, tests, fixes, and status updates; follow the `Return to the native task` contract in `SKILL.md`.

The current CLI refuses batch dispatch before writing coordination state when no verified teammate host adapter is installed. If it refuses, stop at that gate and report the reason; do not emulate the coordinator with individual commands.

## One bounded question

Use `trellis teamwork run` when a single teammate can answer a self-contained question and return one report. Keep the objective, evidence scope, and output request in the prompt. Do not use it to bypass a blocked batch or to create a second coordination path.

## Durable discussion

Use a forum channel when findings need a durable topic, status, or thread history across multiple rounds. A forum is a discussion record; it does not replace task artifacts or the batch coordinator. Read `forum.md` for thread operations.

## Result handling

The batch has only two terminal business outcomes: all planned work units are accepted, or at least one remains failed after its bounded retry policy. Before either receipt, the coordinating agent waits and leaves result interpretation to the program. Once terminal, inspect reports and failures, update the owning task through its native lifecycle, compare the implementation with its design, and perform risk-proportional review and tests. Add missing cases, fix findings, rerun affected checks, and checkpoint the task before reporting progress. Use `trellis task progress [--json]` only as a read-only status summary.
