---
description: "Trellis Copilot prompt: Start Session"
---

# Start Session

Use this prompt to inspect or refresh Trellis context. Copilot also supplies SessionStart context and a per-turn workflow-state breadcrumb through its hooks.

---

## Step 1: Current state
Identity, git status, current task, active tasks, journal location.

```bash
{{PYTHON_CMD}} ./.trellis/scripts/get_context.py
```

If this output includes a line beginning `Trellis update available:`, copy the full line verbatim when summarizing session context. Do not shorten operational command hints.

## Step 2: Workflow overview
Phase Index + skill routing table + DO-NOT-skip rules.

```bash
{{PYTHON_CMD}} ./.trellis/scripts/get_context.py --mode phase
```

Full guide in `.trellis/workflow.md` (read on demand).

## Step 3: Guideline indexes
Discover packages + spec layers, then read each relevant index file.

```bash
{{PYTHON_CMD}} ./.trellis/scripts/get_context.py --mode packages
cat .trellis/spec/guides/index.md
cat .trellis/spec/<package>/<layer>/index.md   # for each relevant layer
```

Index files list the specific guideline docs to read when you actually start coding.

## Step 4: Decide next action
Use the current `<workflow-state>` breadcrumb to identify the business phase; task lifecycle status (`planning` or `in_progress`) and artifact presence do not identify that phase. If the breadcrumb is missing or stale, inspect the task with `task.py phase show <task>` and follow the matching phase Skill in `.trellis/workflow.md`.

- **An active phase is recorded** → continue that phase and load its matching Skill.
- **The task has no initialized phase route** → load `trellis-goal-exploration-and-requirements`, align and obtain the user's confirmation of the current requirements baseline, then initialize the applicable ordered route with `task.py phase init`.
- **No active task** → classify first. Handle a clear, low-risk, reversible, authorized, immediately verifiable request directly; otherwise ask for task-creation consent and begin with `trellis-goal-exploration-and-requirements`.

`task.py start` enters implementation only after an accepted implementation contract from Solution Design and Convergence Phase and separate implementation authorization.

---

## Skill routing (quick reference)

| User intent | Skill |
|---|---|
| Goal and requirements | `trellis-goal-exploration-and-requirements` |
| Decision alternatives | `trellis-decision-space-construction-and-merging` |
| Solution design | `trellis-solution-design-and-convergence` |
| Implementation | `trellis-task-implementation` |
| Delivery review | `trellis-delivery-review-and-closeout` |
| About to write code | `trellis-before-dev` |
| Done coding / quality check | `trellis-check` |
| Stuck / fixed same bug multiple times | `trellis-break-loop` |
| Learned something worth capturing | `trellis-update-spec` |

Full rules + anti-rationalization table in `.trellis/workflow.md`.
