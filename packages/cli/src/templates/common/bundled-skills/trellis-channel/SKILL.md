---
name: trellis-channel
description: Use Trellis channel for live multi-agent collaboration, teammate dispatch, cross-agent review, progress inspection, forum channels, and channel log debugging.
---

# trellis-channel

`trellis channel` is the local multi-agent collaboration runtime. Use it for durable event-log coordination, fixed Teammate assignment plans, existing Channel process commands, and feedback on a durable `--type forum` channel.

Typical user signals: "和 codex/claude 讨论", "brainstorm with another agent", "派一个 implement/check teammate", "let an agent review", "open an issue board / changelog forum", "look at this thread", "channel is stuck / no output", "progress was truncated", "how do I write that channel command".

This skill is an index. Load only the reference file for the current job — do not preload all of them.

## First Commands

```bash
trellis --version
trellis channel --help
trellis channel list --all
trellis channel list --scope global --all
```

If the user names a channel or thread, inspect it before asking for background:

```bash
trellis channel forum <board> --scope global
trellis channel thread <board> <thread> --scope global
trellis channel context list <board> --scope global --thread <thread>
```

## Route By User Intent

| User intent | Read |
|---|---|
| "和 codex/claude 讨论一下", "brainstorm with another agent" | `references/workflows.md` |
| "派一个 implement/check teammate", "let an agent review", "提交固定批次", "批量调查/审查", "等待批次收据" | `references/teammates.md` |
| "使用既有 Channel spawn/run 命令" | `references/command-reference.md`, then `references/workers.md` |
| "开 issue 区 / topic 群 / changelog / board", "make a forum" | `references/forum.md` |
| "看看这个 thread / linked context", "inspect a thread" | `references/forum.md` |
| "Channel 进程卡住了 / 没输出 / progress 被截断" | `references/progress-debugging.md` |
| "具体命令怎么写", "what flags does X take" | `references/command-reference.md` |

## Core Rules

- New forum channels use `--type forum`. A `thread` is one item inside a forum channel.
- Use `--context-file` / `--context-raw` and `trellis channel context add/delete/list`. `--linked-context-*` is deprecated terminology.
- Use `--stdin` or `--text-file` for long messages. Do not put long mixed Chinese/English text in the positional shell argument.
- Pretty `messages` output is an operator dashboard and may truncate progress. Use `--raw` for audit.
- `--as` is the speaker or teammate handle, depending on the command. Use explicit, stable names when multiple agents or sessions are involved.
- `--scope project` (default) operates on the current cwd's project bucket; `--scope global` operates on the shared `__global__` bucket. Pick scope deliberately — a global board is invisible from project listings unless `--scope global` is passed.
- For brainstorm, do multiple pressure-test rounds. One answer plus one confirmation is review, not brainstorm.
- **Dispatcher wait pattern**: use `--kind done` / `--kind turn_finished` (trellis-emitted system events), NOT a user `--tag` as the completion signal. CLI help lists `phase_done` / `question` as `--tag` examples but only `interrupt` is a reserved tag with hardcoded trellis behavior; the others are opaque user labels. Relying on a teammate to run `send --tag <my_signal>` is unreliable — agents may write the tag string into prose instead of running the actual CLI command. See `references/command-reference.md` "tag vs kind".
- Forum channels are event-sourced. Do not parse `events.jsonl` first; use `forum`, `thread`, `messages --thread`, and `context list`.
- `@mindfoldhq/trellis-core` owns reusable channel/thread state, event append, seq allocation, context/title projection, reducers, and task helpers. The CLI owns flags, terminal rendering, prompts, teammate lifecycle, and process exits.

## Fixed Teammate Batches

Use the existing Channel runtime for a frozen batch of read-focused teammate
assignments. This is a Channel operation, not a task or Marketplace workflow.
The main agent prepares and hashes the complete plan, then the program owns
dispatch, FIFO slot refill, timeout continuation, bounded per-work retries,
report validation, reconciliation, and settlement. Do not read or interpret
individual reports while the batch is running.

The plan must bind each work unit to `role_id: teammate`, a provider, an
optional profile/model, an immutable brief, a source digest, acceptance
criteria, and a non-negative `max_retries`. A timeout asks the same attempt to
continue; a confirmed execution or acceptance failure consumes that work unit's
own retry budget and creates a new attempt identity. The teammate never retries
itself and provider-native delegation is disabled.

Capacity is frozen at submission as the minimum of the requested capacity,
`channel.teammate.max_concurrency`, the available
`channel.teammate_guard` capacity, and the verified host capacity. An explicit
request above that limit is rejected. A completed or finally failed unit frees
its logical slot, and the oldest queued unit is dispatched into it.

The current CLI has no verified host adapter, so `trellis channel batch <plan>`
fails closed before writing coordination state. Do not bypass this boundary
with a hand-written host proof or by calling a provider's native delegation
feature. Deterministic coordinator tests may inject a verified runtime; normal
Channel spawn/run behavior remains separate.

## Implementation Completion

Keep task progress in Trellis's native task lifecycle. Use the native task
command when a task enters implementation; after each implementation-plan
step, append the result, changed paths, and verification status to
`<task-path>/execution.md`. Never edit `task.json` status by hand.

Before reporting completion, compare the final diff with the PRD, design, and
implementation plan. Match review and tests to change risk; add cases for
uncovered behavior, fix findings, and rerun affected checks. Record the final
verification and any deferred boundary in the execution checkpoint. Keep the
task `in_progress` until its review and project acceptance gates are complete.

## Reference Files

- `references/workflows.md` — existing collaboration patterns: brainstorm, dispatch-and-wait, forum issue capture, interrupt-and-redirect, and one-shot run.
- `references/forum.md` — forum channels, context, title, rename, changelog forums, thread filtering.
- `references/workers.md` — existing direct Channel process startup, role cards, context injection (`--file` / `--jsonl`), interrupts, and termination semantics.
- `references/teammates.md` — fixed-plan Teammate assignment, program-owned coordination, artifacts, receipts, and provider boundary.
- `references/progress-debugging.md` — progress/raw inspection, stalled Channel process diagnosis, OOM guard, and exit codes.
- `references/command-reference.md` — current CLI command reference (every subcommand, every flag, output conventions, scope/type model).

## Not For

- One static review where a markdown file and prompt are enough.
- Replacing normal tool calls with self-logging.
- Long-term memory retrieval. Use durable forum channels for actionable issues, and `trellis mem` (the `trellis-session-insight` skill) for session/history search.
