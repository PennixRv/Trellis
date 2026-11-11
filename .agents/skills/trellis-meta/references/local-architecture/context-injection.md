# Local Context Injection System

Trellis context injection aims to make AI read the right files at the right time instead of relying on model memory. In a user project, injection is implemented by `.trellis/` scripts together with platform hooks, agents, and skills.

## Injected Context Types

| Type | Source | Purpose |
| --- | --- | --- |
| session context | `.trellis/scripts/get_context.py` | Current developer, git status, active task, active tasks, journal, packages. |
| workflow context | `.trellis/workflow.md` | Current Trellis flow and next action. |
| spec context | `.trellis/spec/` + task JSONL | Specs that must be followed during implementation/checking. |
| task context | `.trellis/tasks/<task-dir>/prd.md`, `design.md`, `implement.md`, `research/` | Current task requirements, design, execution plan, and research. |
| platform context | Platform hooks/settings/agents | Lets different AI tools read the files above through their own mechanisms. |

## session-start

Platforms with session-start support inject a Trellis overview when a session starts, clears, compacts, or receives a similar event. Injected content usually includes:

- workflow summary.
- current task status.
- active tasks.
- spec index paths.
- developer identity and git status.

If the user feels the AI does not know the current task in a new session, first check whether the platform's session-start hook or equivalent mechanism is installed and running.

## workflow-state

workflow-state is a lightweight hint injected around each user turn. Based on current task status, it selects a block from `.trellis/workflow.md`, such as `no_task`, `planning`, `in_progress`, or `completed`.

If the user wants to change "what the AI should do next in a given state," edit the corresponding state block in `.trellis/workflow.md` first.

## 任务与协作上下文

主会话按当前阶段读取任务资产和适用规范。`implement.jsonl`、`check.jsonl` 是按需创建的可选上下文清单，不表示执行者类型或派发许可。Teamwork 通过明确工作包和原生上下文输入消费所需内容；Paseo 节点按实施合同和节点绑定读取上下文。角色卡和 Skill 由各自 owner 维护。

## JSONL Reading Rules

`implement.jsonl` and `check.jsonl` contain one JSON object per line:

```jsonl
{"file": ".trellis/spec/backend/index.md", "reason": "Backend rules"}
```

Readers should skip rows without a `file` field (e.g. legacy `_example` placeholders). When configuring JSONL, the AI should include only spec/research files, not pre-register code files that will be modified.

## Active Task And Context Key

Active task state lives in `.trellis/.runtime/sessions/` and is isolated per session. Hooks try to resolve the context key from platform events, environment variables, transcript paths, or `TRELLIS_CONTEXT_ID`.

If shell commands cannot see the same context key, `task.py current --source` may report no active task. In that case, check whether the platform passes session identity into the shell instead of hand-writing a global current-task file.

## Local Customization Points

| Need | Edit location |
| --- | --- |
| Change session-start injected content | The platform's `session-start` hook or plugin file. |
| Change per-turn workflow-state rules | `[workflow-state:STATUS]` block in `.trellis/workflow.md`. The platform workflow-state hook parses these blocks verbatim and embeds no fallback text. |
| 调整协作上下文 | 对应工作包、原生 Teamwork 输入或 Paseo 节点合同。 |
| Change JSONL validation/display | `.trellis/scripts/common/task_context.py`. |
| Change active task resolution | `.trellis/scripts/common/active_task.py`. |

When modifying context injection, verify two things: new sessions can see the correct task, and the current session or collaboration node sees its own task artifacts/spec/research.
