---
description: "Route a Trellis task through its current phase."
---

# Requirements and phase routing

Use `.trellis/workflow.md` and the current workflow-state breadcrumb as the authority for the task's phase. Task lifecycle status and artifact presence do not identify the business phase.

- No active task: if the request needs a Trellis task, obtain task-creation consent, create it, and load `trellis-goal-exploration-and-requirements`. Handle eligible low-risk, authorized work through the taskless route.
- Task without an initialized phase route: use `trellis-goal-exploration-and-requirements` to align the requirements; initialize the applicable ordered route only after the user confirms the current requirements baseline.
- Task with an active phase: load the Skill matching that phase. This shortcut must not reset or bypass the current phase.

`task.py start` enters implementation only after the accepted Solution Design and Convergence Phase implementation contract and separate implementation authorization. The phase Skills define their own activities and acceptance conditions; do not impose a fixed number of questions, alternatives, or planning documents.
