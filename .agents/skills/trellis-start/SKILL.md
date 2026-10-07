---
name: trellis-start
description: "Initialize missing Trellis context once for a new session or changed project. Read workflow, identity, task and guidelines as needed. Do not invoke for an ordinary continue, new task, or compaction recovery when the current context or summary already supplies the project and checkpoint."
---

# Start Session

Initialize a Trellis-managed development session. This platform has no session-start hook, so manually load the equivalent compact context by following these steps.

Run this initialization once when project context is genuinely missing or the
target project changes. Existing session context and a sufficient compaction
summary count as loaded context. An ordinary continue or new task in the same
known project resumes the pending action without repeating these steps. For
partial missing/conflicting facts, query only the needed owner evidence.

---

## Step 1: Current state
Identity, git status, current task, active tasks, journal location.

```bash
python3 ./.trellis/scripts/get_context.py
```

If this output includes a line beginning `Trellis update available:`, copy the full line verbatim when summarizing session context. Do not shorten operational command hints.

## Step 2: Workflow overview
Compact Phase Index, request triage rules, planning artifact contract, and the step-detail command.

```bash
python3 ./.trellis/scripts/get_context.py --mode phase
```

Full guide in `.trellis/workflow.md` (read on demand).

## Step 3: Guideline indexes
Discover packages + spec layers, then read each relevant index file.

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
cat .trellis/spec/guides/index.md
cat .trellis/spec/<package>/<layer>/index.md   # for each relevant layer
```

Index files list the specific guideline docs to read when you actually start coding.

## Step 4: Decide next action
From Step 1 you know the current task and status. Check the task directory:

- **Active task with `task.json.meta.delivery_mode = "analysis_only"`** → keep `planning`, complete the PRD's bounded evidence work, then verify the no-change boundary, commit task artifacts, and archive directly. Do not run `task.py start`; any protected-target change needs a separate change-bearing task.
- **Active task status `planning` + no `prd.md`** → Phase 1.1. Load the `trellis-brainstorm` skill.
- **Active task status `planning` + `prd.md` exists** → stay in Phase 1. Lightweight tasks can be PRD-only; complex tasks need `design.md` + `implement.md`. Load the relevant Phase 1 step detail before `task.py start`.
- **Existing task selected by explicit intent but not bound** → use native `task.py select` for context only. Drain already dispatched Channel units before a real task switch. Planned/change-bearing start requires native plan seal and matching later approval for this task's current material revision; selecting or recovering context does not approve implementation.
- **Active task status `in_progress`** → Phase 2 step 2.1. Load the step detail:
  ```bash
  python3 ./.trellis/scripts/get_context.py --mode phase --step 2.1 --platform codex
  ```
- **No active task** → classify first. Simple conversation needs no task. Bounded direct work uses the workflow's direct path without a mandatory task-creation question. Complex work creates a task and enters planning when authorized; ask only if the necessary authorization is missing.

---

## Skill routing (quick reference)

| User intent | Skill |
|---|---|
| New feature / unclear requirements | `trellis-brainstorm` |
| About to write code | `trellis-before-dev` |
| Done coding / quality check | `trellis-check` |
| Stuck / fixed same bug multiple times | `trellis-break-loop` |
| Learned something worth capturing | `trellis-update-spec` |

Full rules + anti-rationalization table in `.trellis/workflow.md`.
