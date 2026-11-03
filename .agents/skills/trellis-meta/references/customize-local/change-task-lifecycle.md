# Change Local Task Lifecycle

Read the installed project's workflow and task record before changing task creation or lifecycle behavior. 任务目录由 status 投影到 planning、in_progress、completed/YYYY-MM、cancelled；完成或取消必须通过原生事务同步移动、引用与会话清理，不能只改字段或手工移动目录。

## Read these files first

1. .trellis/workflow.md
2. .trellis/config.yaml
3. .trellis/scripts/task.py
4. .trellis/scripts/common/task_store.py
5. .trellis/scripts/common/task_workflow.py
6. .trellis/scripts/common/task_layout.py and task_move.py
7. The current task's task.json

## Common edit points

| Need | Edit point |
| --- | --- |
| Run a script after task creation or start | hooks.after_create or hooks.after_start in .trellis/config.yaml |
| Run a script after clearing the session task pointer | hooks.after_finish in .trellis/config.yaml |
| Change default task fields | .trellis/scripts/common/task_store.py |
| Change task parsing or lookup | .trellis/scripts/common/task_utils.py |
| Change lifecycle and phase contracts | .trellis/scripts/common/task_workflow.py and Core task model |
| Change active task behavior | .trellis/scripts/common/active_task.py and host integration |

Lifecycle hooks receive TASK_JSON_PATH for the affected task. Hook failures should follow the existing behavior of the native operation and must not silently corrupt task state.

Keep project-specific fields under task.json meta unless the standard schema must change. When changing the schema, inspect every reader and writer.

## Active task behavior

The active task pointer is scoped to an AI session under .trellis/.runtime/sessions/. Use task.py current to inspect it, task.py start to attach a task to the current session, and task.py finish to clear that session pointer. Do not introduce a shared global pointer.

When task.py create runs inside a session with a recognized session identity, it attaches the new task to that session. Outside such a session, the task is still created but no pointer is changed; task.py start can attach it later.

## Modification steps

1. Confirm the active task through task.py current --source.
2. Inspect its task.json and phase state.
3. Read the applicable Trellis specs.
4. Change the native script or configuration that owns the behavior.
5. Synchronize .trellis/workflow.md and affected host integrations.

Do not hand-edit runtime pointers or phase state. Do not change task lifecycle outside the Trellis CLI contract.
