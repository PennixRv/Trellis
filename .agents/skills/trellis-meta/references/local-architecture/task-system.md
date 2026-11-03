# Local Task System

任务按状态存放于 `.trellis/tasks/planning/<task>`、`in_progress/<task>`、`completed/YYYY-MM/<task>`、`cancelled/<task>`。`task.json.status` 是唯一状态事实；目录只投影状态，不增加第五种状态。创建进入 planning，获准实施的 start 进入 in_progress，complete 进入当月 completed，cancel 进入 cancelled。任务身份和父子关系不因移动改变。

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

The read-only trellis task progress command summarizes planning, in_progress, completed, and cancelled lifecycle records, with a partial flag for unreadable or inconsistent input. It does not change task state.

## 布局迁移与恢复

旧平铺目录和 `archive/YYYY-MM` 只能作为显式迁移输入。先运行 `task.py migrate-layout` 预览，再使用 `--apply`；已完成 archive 任务保留原月份，非终态任务按真实状态归位，不伪造完成。`--recover` 恢复未完成事务。重复名称、无效 JSON、符号链接、未知执行资源或交接所有权冲突会阻止迁移；不跳过记录。

移动同步 JSON/JSONL 机器引用、会话指针及 runtime 哈希索引；终态操作在同一事务中清除本任务 runtime。历史正文和正式交接包保留。内容绑定的接受证据或 continuity digest 失效后，通过原生重新接受和 capture 核对，不静默重授历史授权。handoff ownership 在 `consume` 后完成转移；后续普通任务修改不更新交接代次，需要查看现场时使用只读 `transfer status --include-current`。文档中的 `<task-dir>` 指包含状态及必要月份的真实任务相对路径。

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
