# Workflow-State Breadcrumb Contract

> Runtime contract for the per-turn `<workflow-state>` breadcrumb that
> `inject-workflow-state.py` / `inject-workflow-state.js` inject into
> every UserPromptSubmit.

---

## Overview

The breadcrumb supplies main-session phase guidance. Every required workflow gate must be represented by the corresponding native phase block. Task CLI owns lifecycle and phase state; the breadcrumb does not authorize implementation or collaboration. Hosts may expose main-session context in other turns, so guidance must preserve the current work-package boundary without inferring new authority.

This document is the source of truth for the runtime mechanics. The user-facing
breadcrumb body lives in `.trellis/workflow.md` — or in the active task's
selected variant file (see "Per-task workflow resolution" below); this spec
covers everything **around** it (parsers, writers, lifecycle, reachability).

---

## Marker syntax

Each breadcrumb body lives in a managed block of `.trellis/workflow.md`:

```
[workflow-state:STATUS]
<one or more lines of body text>
[/workflow-state:STATUS]
```

- STATUS character set: `[A-Za-z0-9_-]+` (letters, digits, underscores,
  hyphens). Examples: `planning`, `in_progress`, `in-review`, `blocked-by-team`.
- The body is read verbatim and inlined into the `<workflow-state>` block.
- Both the opening and closing tags must end with the same STATUS string.

The regex used by both the Python hook (`packages/cli/src/templates/shared-hooks/inject-workflow-state.py`)
and the OpenCode plugin (`packages/cli/src/templates/opencode/plugins/inject-workflow-state.js`)
is:

```
[workflow-state:([A-Za-z0-9_-]+)]\s*\n(.*?)\n\s*[/workflow-state:\1]
```

### Invariant: parser regex ↔ strip regex must use the same `\1` backreference

There are two regex consumers of the marker syntax:

1. **Parser** — extracts tag content for breadcrumb emission. Lives in `inject-workflow-state.py` (`_TAG_RE`) and `inject-workflow-state.js`.
2. **Stripper** — removes tag blocks from the workflow.md range injected at SessionStart (so AI doesn't read each block twice — once in the workflow overview, once in the per-turn breadcrumb). Lives in `session-start.py` (shared / codex / copilot copies), `workflow_phase.py`, and any future SessionStart-equivalent script.

Both regexes MUST use the `\1` backreference variant — `[workflow-state:([A-Za-z0-9_-]+)]...[/workflow-state:\1]` — so they only match well-formed pairs (same STATUS on open and close). A non-backreference variant like `[workflow-state:[A-Za-z0-9_-]+]...[/workflow-state:[A-Za-z0-9_-]+]` permits `STATUS_A...STATUS_B` mismatches, which can swallow surrounding content if a user typo'd the closing tag.

**Symptom of drift**: parser would refuse to emit content for a typo'd block (because parser uses `\1`), but stripper would silently consume it from the SessionStart payload (because stripper used the loose form). End result: the AI never sees that content via either channel — silent loss.

**Test invariant**: `test/regression.test.ts` `[strip-breadcrumb] _strip_breadcrumb_tag_blocks only strips matched STATUS pairs` covers the three boundary cases (matched, mismatched, nested orphan) for the strip side. The parser already enforces same-status pairing structurally via `\1`.

---

## Runtime contract

1. On every UserPromptSubmit (or platform equivalent — see hook reachability
   matrix below), the hook receives stdin JSON containing `cwd`.
2. It walks up from `cwd` to find `.trellis/`. If none, exit 0.
3. It calls `common.active_task.resolve_active_task()` to look up the
   per-session active task. If absent → status is the pseudo `no_task`. If
   the pointer is stale (task dir deleted) → status is `stale_<source_type>`.
4. Otherwise it reads `task.json.status` from the resolved task directory. If
   the task directory exists but `task.json` is missing, malformed, or has no
   usable status, the hook emits the `task_error` pseudo-status and keeps the
   task directory name in the breadcrumb header.
5. It resolves the workflow file (per-task resolution order below: the
   active task's `.trellis/workflows/<id>.md` when selected, else
   `.trellis/workflow.md`) and parses every `[workflow-state:STATUS]` block.
6. All main-session platforms use the plain task lifecycle status and current named phase. Execution policy does not create virtual platform or status labels.
7. It looks up the current status in the parsed map. If found → emits the
   block body in `<workflow-state>...</workflow-state>`. If not found →
   emits the generic line `Refer to workflow.md for current step.`
8. The output JSON has shape:

   ```json
   {"hookSpecificOutput": {
     "hookEventName": "<platform-event-name>",
     "additionalContext": "<workflow-state>...</workflow-state>"
   }}
   ```

   The platform host injects `additionalContext` as system-level preamble
   for that turn.

   `hookEventName` MUST echo the host's per-turn event name or the host's
   schema validator will reject the payload. The shared hook detects the
   platform via `_detect_platform()` and emits the matching value:

   | Detected platform | `hookEventName` value |
   |---|---|
   | gemini | `BeforeAgent` |
   | all others (claude, cursor, codex, qoder, codebuddy, droid, copilot, kiro) | `UserPromptSubmit` |

   When adding a new hook-capable platform whose per-turn event name is not
   `UserPromptSubmit`, extend `_detect_platform()` and the `hook_event_name`
   selector in `inject-workflow-state.py` (and the OpenCode `.js` plugin if
   the new platform shares its transform envelope). Do NOT
   hardcode `UserPromptSubmit` at any new emission site.

---

## Per-task workflow resolution

`.trellis/workflow.md` is the **global** workflow. A task may pin a variant
by storing `"workflow": "<id>"` in its task.json (writers: `task.py create
--workflow <id>`, `task.py workflow <id>` / `--clear`); variant bodies live
in the user-managed library `.trellis/workflows/<id>.md`, populated by
`trellis workflow --save <id>` (see `commands-workflow.md`). Every runtime
consumer of workflow markdown resolves the path with the same rule, whose
single source is `.trellis/scripts/common/workflow_selection.py`. It is a
**precedence chain**, highest to lowest — each layer maps an id to
`.trellis/workflows/<id>.md` and falls through when the id is unset, invalid
(fails `^[A-Za-z0-9_-]+$`), or names a missing file:

1. **Per-task pin** — active task's task.json `workflow` (session-bound,
   explicit; writers: `task.py create --workflow <id>`, `task.py workflow
   <id>` / `--clear`). An invalid id or missing variant file emits one warning
   line on **stderr** (never stdout — stdout is hook JSON) and then falls
   through to the default chain below (it does not abort to global).
2. **Personal override** — `.developer` `workflow=<id>` line. The `.developer`
   file is gitignored and per-developer, so this is a local, un-committed
   override that outranks the team default. Silent on miss (a default, not an
   explicit per-task choice — a per-turn warning would be noise).
3. **Team default** — config.yaml `default_workflow: <id>` (top-level key).
   Committed, so the whole team shares it. Silent on miss.
4. **Global** — `.trellis/workflow.md`.

With neither a per-task pin nor the personal/team keys set, resolution is
byte-identical to reading the global `.trellis/workflow.md` (the pre-feature
behavior).

> **Precedence provenance (2026-07-23 colleague transcript)**: the personal >
> team layering and "personal not in git, higher priority" come directly from
> the transcript (16:44:23 team-shared config default; 16:44:39 personal layer,
> not uploaded to git, higher priority). The implementation stores the personal
> id in the existing gitignored `.developer` key-value file and places an
> explicit per-task pin above that developer-wide default. See task
> `07-24-workflow-config-default/prd.md`.

The resolver never raises. The hooks additionally wrap the
`common.workflow_selection` import itself in try/except and fall back to the
global path (older installed projects may not ship the module; hooks must
never crash the session).

Consumers that resolve per-task:

| Consumer | Serves |
|---|---|
| `shared-hooks/session-start.py` (`_resolve_workflow_md`) | SessionStart Phase Index (`<trellis-workflow>` block) |
| `shared-hooks/inject-workflow-state.py` (`load_breadcrumbs`) | per-turn `[workflow-state:*]` breadcrumb bodies |
| `scripts/common/workflow_phase.py` (`get_context.py --mode phase`) | phase/step detail bodies |
| `opencode/plugins/inject-workflow-state.js` (`resolveWorkflowMd`) | per-turn breadcrumbs (JS port; mirrors the Python rule for the same inputs) |
| `pi/extensions/trellis/index.ts.txt` (`resolveWorkflowMd`) | per-turn breadcrumbs (TS port; mirrors the Python rule for the same inputs) |
| `codex/hooks/session-start.py` + `copilot/hooks/session-start.py` (`_resolve_workflow_md`) | platform-specific SessionStart Phase Index TOC |

Known degradation: the OMP extension keeps injecting the global
`.trellis/workflow.md` regardless of per-task, personal, or team selection.
Parity there is a tracked follow-up.

Absent a per-task pin **and** the personal/team default keys, every consumer
resolves to the global `.trellis/workflow.md` — output is byte-identical to a
project without the feature.
Variant files must satisfy the same parser contract as `workflow.md` (marker
syntax above, `## Phase Index`, `#### X.Y` step headings, platform markers);
`trellis workflow --save` warns at save time when markers are missing.

---

## OpenCode messages.transform contract

### 1. Scope / Trigger

OpenCode SessionStart and per-turn workflow-state plugins inject Trellis
context through `experimental.chat.messages.transform`. That hook runs on
the in-memory transcript OpenCode is about to convert to model messages
(`SessionPrompt.run` and compaction). It does not write SQLite / TUI /
Web history. `chat.message` remains the persist path and must not be used
for Trellis context (issue #553, replacing the persisted-synthetic-part
contract from #524).

### 2. Signatures

- `findLatestUserMessageIndex(messages) -> number`
- `latestUserPromptText(messages) -> string`
- `platformInputFromMessages(messages) -> { sessionID, agent } | null`
- `prependEphemeralText(messages, text) -> boolean`
- Hook name: `experimental.chat.messages.transform`
- Hook input from OpenCode is `{}`; session identity is read from the
  latest user message `info`.

### 3. Contracts

- Only the latest `info.role === "user"` message is cloned. Earlier user
  and assistant messages stay the original object references.
- The clone prepends `{ type: "text", text, synthetic: true }` parts.
  Ordinary parts on the clone keep their original objects; the original
  message's `parts` array is not mutated.
- Injection does not require a persisted `prt_...` identity. Attachment-only
  latest user messages still receive the ephemeral text parts.
- Workflow-state checks the skip keyword only against ordinary user text
  (`findUserTextPart`), never against ephemeral or stored synthetic parts.
- SessionStart injects rebuilt compact context onto the latest user message
  every model call. `<first-reply-notice>` is included only when the
  transcript has no assistant message.
- Plugin error handling leaves `output.messages` unchanged (prepend is the
  last step).
- Trellis sub-agent turns (`info.agent` matching `trellis-implement` /
  `trellis-check` / `trellis-research`) skip both plugins.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| `messages` is missing or has no user message | No-op |
| Latest user message has no ordinary text part | Still prepend ephemeral text (attachment-only turns) |
| Skip keyword present in ordinary latest-user text | Workflow-state no-op; SessionStart still injects |
| `TRELLIS_HOOKS=0` / `TRELLIS_DISABLE_HOOKS=1` / `OPENCODE_NON_INTERACTIVE=1` | Both plugins no-op |
| Plugin order is reversed | Both ephemeral parts still precede ordinary latest-user parts |

### 5. Good / Base / Bad Cases

- Good: a two-turn transcript's first user message is byte-identical after
  transform; only the latest user message clone carries `<session-context>`
  and `<workflow-state>`.
- Base: an attachment-only latest user message gets ephemeral text parts
  prepended; the file part object is unchanged.
- Bad: mutating `chat.message` `output.parts` persists Trellis context into
  history and makes revert restore it into the prompt box.

### 6. Tests Required

- Helper tests cover latest-user selection, clone-not-mutate, and prepend
  onto attachment-only messages.
- Real plugin tests run both plugin orders against a multi-turn transcript
  and deep-compare every historical message.
- SessionStart tests cover first-reply-notice presence vs absence after an
  assistant turn. Workflow tests cover default/custom/disabled skip keywords.
- Existing hook-disable, non-interactive, and Trellis sub-agent exclusion
  tests remain mandatory, aimed at the transform hook.
- Template collection tests assert the helper ships through both fresh init
  and `trellis update`; dogfood `.opencode/` copies must match template bytes.

### 7. Wrong vs Correct

#### Wrong

```javascript
parts[0].text = `${breadcrumb}\n\n${parts[0].text}`
insertSyntheticTextPart(parts, breadcrumb, "workflowState")
```

Both persist machine context into OpenCode history. The first also rewrites
the user's visible message.

#### Correct

```javascript
if (promptHasSkipKeyword(latestUserPromptText(messages), skipKeyword)) return
prependEphemeralText(messages, breadcrumb)
```

This changes only the in-memory model payload. Stored history and the TUI
keep the original user message.

---

## Source of truth

`workflow.md` is **the only editable source** for breadcrumb body text. The
hook scripts (`.py` and `.js`) contain only the parser, no fallback text.

**Why no fallback dicts**: prior to v0.5.0-beta.20, both hook scripts shipped
a `_FALLBACK_BREADCRUMBS` / `FALLBACK_BREADCRUMBS` dict mirroring the
workflow.md content. The mirror inevitably drifted (different word polish in
each file), and the architecture invited copy-paste skew. Removing the
fallback collapses three sources to one. When `workflow.md` is missing or a
tag is absent, the hook degrades to the generic line — visible to the user as
an obvious bug they can fix, rather than being silently masked.

To customize breadcrumb wording, edit the `[workflow-state:STATUS]` block in
`.trellis/workflow.md` (or in the task's selected variant file). No script
change required.

### Update boundary

The `[workflow-state:STATUS]` blocks are not the only runtime-sensitive
content in `workflow.md`. Phase headings, step headings, and platform marker
blocks such as `[codex-inline, Kilo, Antigravity, Devin]` are parsed by
`workflow_phase.py` / `get_context.py` when step-specific instructions are
loaded.

For that reason, `trellis update` must update `workflow.md` as one managed
template file whenever the installed file still matches its tracked template
hash. It must not partially merge only `[workflow-state:*]` blocks. User edits
are protected by the normal hash-based modified-file flow, not by preserving
arbitrary prose outside tag blocks during automatic updates.

Regression invariant: an older hash-tracked workflow containing stale Codex
markers (`[Codex]` plus `[Kilo, Antigravity, Windsurf]`) must be replaced by
the current packaged template so `--platform codex` can resolve to
`codex-inline` or `codex-sub-agent` and still load Phase 2.1 detail.

---

## Status writer table

`task.json.status` 只有 planning、in_progress、completed、cancelled 四种原生状态。目录只是状态投影；移动不改变 task identity、parent/children 或阶段路线。

| Writer | 状态与目录 | 条件 |
| --- | --- | --- |
| `task_store.cmd_create` | planning / `planning/<task>` | 创建不授予实施权限；按会话身份附加指针。 |
| `task._record_start_state` | in_progress / `in_progress/<task>` | 已接受的实施合同及当前实施授权有效。 |
| `task_workflow.cmd_complete_task` | completed / `completed/YYYY-MM/<task>` | 当前交付审查已接受且资源安全；新完成按完成月。 |
| `task_workflow.cmd_cancel_task` | cancelled / `cancelled/<task>` | 用户撤回且取消审查已接受。 |
| `emptyTaskJson`、bootstrap/joiner、update migration task | planning / `planning/<task>` | 不推断阶段接受或实施授权。 |

`task_move.relocate_task` 在同一恢复事务中写入状态、移动目录、更新机器引用，并在终态清除任务 runtime。`migrate-layout` 仅按已有 status 修复目录，保留旧 archive 的完成月份，不推断完成或取消；`rename` 保持状态与月份。普通任务入口不接受旧平铺或 archive 布局。

历史记录缺少 `meta` 时，只有显式 `phase init` 可以补建空对象并初始化路线；已有 `meta` 类型错误仍须拒绝，不改写任务。读取、取消和其他阶段操作不得隐式初始化或授予实施权限。

## Lifecycle events ≠ status transitions

Lifecycle events fire on task-management commands, NOT on status changes.
Subscribers must understand the difference:

| Event | Emitted at | Status when fired |
|-------|------------|-------------------|
| `after_create` | end of `cmd_create` | `"planning"` (just written) |
| `after_start` | end of `cmd_start` | `"in_progress"` if status was `"planning"`; otherwise unchanged. Re-running `start` does NOT re-fire status flip. |
| `after_finish` | end of `cmd_finish` | **unchanged** — `cmd_finish` only clears the per-session active-task pointer. Status stays whatever it was (typically `"in_progress"`). |
| `after_complete` | end of `cmd_complete_task` | completed，事务已提交，任务已位于 completed/YYYY-MM；`TASK_JSON_PATH` 为新路径。 |

**Common mistake**: subscribing to `after_finish` to mark a task "done" in an
external system (Linear, Jira). `after_finish` means "AI session closed its
pointer to this task" — the task may resume in a different session. The
correct event for "task is done" is `after_complete`. Cancellation does not emit this completion hook.

---

## Reachability matrix

Which breadcrumbs actually fire in normal flow:

| Status | Reachability | Notes |
|--------|--------------|-------|
| `no_task` | ✅ reachable | Pseudo-status; emitted when `resolve_active_task()` returns no pointer. |
| `planning` | ✅ reachable | After `cmd_create` (which now auto-sets the session pointer when available) and before `cmd_start`. |
| `in_progress` | ✅ reachable | After `cmd_start`, until `complete` or `cancel`. |
| `completed` / `cancelled` | 生命周期终态；普通活动指针已清除 | 原生完成或取消会在事务中清除指针；不会将终态目录误作正在实施任务。 |
| `stale_<source_type>` | ✅ reachable (rare) | Synthesized when the session pointer references a deleted task directory. Emits the generic body via `build_breadcrumb` because no `stale_*` tag is shipped. |

**Test invariant**：`no_task` 保留请求分流，planning 保留当前需求确认、设计接受和独立实施授权，in_progress 按当前阶段继续。phase workflow 不得因状态目录变动丢失。`task-layout.integration.test.ts`、`task-workflow.integration.test.ts` 和 `regression.test.ts` 覆盖迁移、生命周期、指针及提示注入。

---

## Custom statuses

Forks can define custom statuses. To do so:

1. Add a `[workflow-state:my-status]...[/workflow-state:my-status]` block to
   `.trellis/workflow.md` (STATUS charset: `[A-Za-z0-9_-]+`).
2. Add a lifecycle hook (`task.json.hooks.after_*`) that writes
   `task.json.status = "my-status"` at the appropriate event. Without a
   writer, the tag is never read because no task ever carries that status.
3. (Optional) Add the status to `.trellis/spec/cli/backend/workflow-state-contract.md`'s
   writer table when shipping the customization to other repos.

---

## Main-session context channels

Startup Hooks, per-turn workflow state and path-scoped specs are separate main-session channels. Optional JSONL is context data. Native subagent context Hooks, pull preludes, mode banners and child identity shards are removed. The main session integrates read-only Teamwork evidence and authorized Paseo implementation results; host context visibility does not change ownership.

## DO

- Edit `.trellis/workflow.md` `[workflow-state:STATUS]` blocks for breadcrumb
  body changes; never touch the parser scripts.
- Keep `trellis update` whole-file behavior for hash-tracked `workflow.md`.
  Breadcrumb tag updates alone are insufficient because platform routing
  markers outside those tags are runtime input too.
- Add a writer-table row to this spec when introducing a new status writer.
- Run the regression tests after editing breadcrumb bodies.
- When adding a `[required · once]` step to the workflow walkthrough, add a
  matching enforcement line to that phase's breadcrumb tag block in the
  same commit.

## DON'T

- Don't add fallback breadcrumb dicts back to `inject-workflow-state.py` or
  `.js`. Drift is structurally guaranteed.
- Don't implement special partial merging for `workflow.md` unless every
  runtime parser that consumes headings, platform blocks, and breadcrumb tags
  has an explicit compatibility strategy and upgrade test coverage.
- Don't introduce a `task.json.status` writer without updating this spec.
- Don't subscribe to `after_finish` to detect task completion — it doesn't
  mean what you think. Use `after_complete`.
- Don't silently re-route a writer to a different status without auditing
  every breadcrumb consumer (`session-start.py`, `inject-workflow-state.py`,
  `task.py list`, etc.).
- Don't rely on sub-agents not seeing the breadcrumb. If guidance is sub-agent
  relevant, propagate it via the appropriate channel above and keep the
  breadcrumb wording self-exempting.

---

## Mandatory triggers (must update this spec when changing)

- Marker syntax (regex / charset)
- Per-task resolution rule change (`workflow_selection` resolution order, id
  charset, or the per-task consumer list above)
- Hook script structural change (parser, output envelope, what reads
  `task.json.status`)
- `workflow.md` update semantics in `trellis update`
- New `task.json.status` writer (any path that mutates the field)
- Breadcrumb body that changes the contract (e.g. removing a `[required ·
  once]` enforcement line — flag in PR description)
- New lifecycle event added to `run_task_hooks`
- Reachability changes (e.g. wiring a new status transition that makes
  `completed` reachable)

Cross-reference: `cli/backend/quality-guidelines.md` "Routing Fixes: Audit
ALL Entry Paths" — that audit pattern is what this contract enforces for
the breadcrumb subsystem.
