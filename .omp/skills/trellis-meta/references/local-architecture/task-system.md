# Local Task System

Tasks live under .trellis/tasks/. A task record keeps its artifacts and history in place after completion or cancellation; Trellis does not move tasks into an archive.

## Task records

Each task directory may contain task.json, prd.md, design.md, implement.md, research/, and context manifests. Use only the artifacts needed by the task.

task.json records identity, lifecycle status, ownership, and parent/child relationships. The Trellis CLI task workflow record stores the ordered phase route, current phase, revisions, evidence, acceptance, and authorization. Do not edit lifecycle or phase status by hand.

## Parent and child tasks

A parent groups related deliverables and records cross-task acceptance. Each child has its own task record and lifecycle. Record dependencies explicitly in task artifacts; tree position does not imply execution order.

## Active task context

The active task pointer is scoped to an AI session under .trellis/.runtime/sessions/. Use task.py current to inspect it, task.py start to attach a task to the current session, and task.py finish to clear the current session pointer. Do not create a shared global pointer.

## Native task operations

    python3 ./.trellis/scripts/task.py create "<title>" --description "<summary>" [--parent <task>]
    python3 ./.trellis/scripts/task.py phase show <task>
    python3 ./.trellis/scripts/task.py validate <task>
    python3 ./.trellis/scripts/task.py start <task>
    python3 ./.trellis/scripts/task.py complete <task>
    python3 ./.trellis/scripts/task.py cancel <task> --reason "<reason>" --evidence-ref <reference>

Use phase operations through task.py phase for artifact revisions, acceptance, evidence-backed skips, waits, blocks, resume, return, route, and authorization. Consult task.py help for current arguments. Completion and cancellation occur only after Delivery Review and On-Site Closeout Phase.

The read-only trellis task progress command summarizes planning, in_progress, and completed lifecycle records. It does not change task state.

## Context manifests

implement.jsonl and check.jsonl identify relevant spec and research files for agents that consume those manifests. They do not replace the task's planning artifacts. Keep entries curated and remove placeholder rows rejected by task.py validate.

## Local customization points

| Need | Edit location |
| --- | --- |
| Change task fields or creation | .trellis/scripts/common/task_store.py |
| Change task lookup or parsing | .trellis/scripts/common/task_utils.py |
| Change lifecycle and phase contracts | .trellis/scripts/common/task_workflow.py and Core task model |
| Change active session task behavior | .trellis/scripts/common/active_task.py and host integration |
| Change task guidance | .trellis/workflow.md and the applicable phase Skill |
