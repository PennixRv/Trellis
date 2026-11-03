---
name: trellis-teamwork
description: Use Trellis Teamwork for live multi-agent collaboration, Teamwork Sessions, teammate assignments, coordination modes, and runtime diagnostics.
---

# trellis-teamwork

`trellis teamwork` is the local multi-agent collaboration runtime. A
Teamwork Session is the persistent chat or forum object used by the runtime;
it is independent from the Trellis task lifecycle and does not own business-phase progress.
Use Teamwork when agents need a durable event log, a bounded teammate
assignment, a one-shot consultation, or a forum discussion.

Typical user signals: “和 codex/claude 讨论”, “brainstorm with another agent”, “派一个 teammate 做 review”, “open a Teamwork forum”, “look at this thread”, “Teamwork 卡住了 / 没输出”, “progress was truncated”, “how do I use trellis teamwork”.

This skill is an index. Load only the reference file for the current job — do not preload all of them.

## First Commands

```bash
trellis --version
trellis teamwork --help
trellis teamwork list --all
trellis teamwork list --scope global --all
```

If the user names a Teamwork Session or thread, inspect it before asking for
background:

```bash
trellis teamwork forum <session> --scope global
trellis teamwork thread <session> <thread> --scope global
trellis teamwork context list <session> --scope global --thread <thread>
```

## Route By User Intent

| User intent | Read |
|---|---|
| `general`: bounded research, review, or verification assignments | `references/teamwork-plan-construction.md`, then `references/coordination-modes.md` |
| Advisor: one bounded consultation | `references/coordination-modes.md` |
| `committee`: parallel assessment by two or three distinct lenses | `references/coordination-modes.md` |
| “和 codex/claude 讨论一下”, “brainstorm with another agent” | `references/teamwork-plan-construction.md`, then `references/coordination-modes.md` |
| “派 teammate 做研究或验证”, “让 agent review”, “spawn a worker” | `references/teamwork-plan-construction.md`, then `references/teammate-processes.md` |
| “开 issue 区 / topic 群 / changelog / board”, “make a forum” | `references/teamwork-plan-construction.md` |
| “看看这个 thread”, “inspect a thread” | `references/teamwork-plan-construction.md` |
| “Teamwork 卡住了 / 没输出 / progress 被截断”, “teammate stalled” | `references/teammate-processes.md` |
| “具体命令怎么写”, “what flags does X take” | `references/teamwork-plan-construction.md` |

## Core Rules

- Teammates provide research, review, verification, evidence, and advice under a role contract; they do not implement product code. Coding tools or provider permission modes do not grant that role authority. Return results in the assigned format and let the coordinator review them.
- `general`, `advisor`, and `committee` are coordination modes, independent from `run`, batch execution, and forum sessions. The current `batch` CLI is reserved and refuses dispatch; see the plan reference for the current boundary.
- New forum Teamwork Sessions use `--type forum`. A `thread` is one item inside a forum Teamwork Session.
- Use `--context-file` / `--context-raw` and `trellis teamwork context add/delete/list`.
- Use `--stdin` or `--text-file` for long messages. Do not put long mixed Chinese/English text in the positional shell argument.
- Pretty `messages` output is an operator dashboard and may truncate progress. Use `--raw` for audit.
- `--as` is the speaker or worker handle, depending on the command. Use explicit, stable names when multiple agents or sessions are involved.
- `--scope project` (default) operates on the current cwd's project bucket; `--scope global` operates on the shared `__global__` bucket. Pick scope deliberately — a global board is invisible from project listings unless `--scope global` is passed.
- For brainstorm, do multiple pressure-test rounds. One answer plus one confirmation is review, not brainstorm.
- **Dispatcher wait pattern**: use `--kind done` / `--kind turn_finished` (Trellis-emitted system events), not a user `--tag` as the completion signal. Tags are labels, not runtime completion events.
- Teamwork Sessions are event-sourced. Do not parse `events.jsonl` first; use `forum`, `thread`, `messages --thread`, and `context list`.
- `@pennixrv/trellis-core` owns reusable Teamwork Session/thread state, event append, sequence allocation, context/title projection, reducers, and task helpers. The CLI owns flags, terminal rendering, prompts, teammate lifecycle, and process exits.
- Teamwork plan construction belongs to the current phase coordinator. Teamwork validates and executes a frozen plan; it does not select the task phase, change task status, or create a second task state machine.
- The native host-created `subagent` remains separate from a Teamwork teammate.

## Reference Files

- `references/teamwork-plan-construction.md` — plan binding, task integration, Teamwork Session and forum commands, reports, and cleanup.
- `references/teammate-configuration-matrix.md` — candidate profiles, frozen execution configuration, provider capabilities, and role boundaries.
- `references/coordination-modes.md` — `general`, `advisor`, and `committee` semantics and selection.
- `references/teammate-processes.md` — dispatch, context injection, waiting, interruption, retry, reconciliation, and diagnostics.

## Not For

- One static review where a markdown file and prompt are enough.
- Replacing normal tool calls with self-logging.
- Long-term memory retrieval. Use durable forum Teamwork Sessions for actionable issues, and `trellis mem` (the `trellis-session-insight` skill) for session/history search.
