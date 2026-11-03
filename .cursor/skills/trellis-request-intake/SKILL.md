---
name: trellis-request-intake
description: "Routes a new request by its relationship to the active task, existing authorization and the taskless contract. Creates or selects a task and hands off to the appropriate phase when needed. Use for new work or a new request during an existing session; use trellis-continue to resume existing work."
---

# Trellis Request Intake

Use this entry skill to route a new request. First check its relationship to the active task: a change to the same goal returns to the earliest affected phase; independent work needs its own intake. Do not put unrelated work into the active task or bypass its ownership and acceptance gates. To resume existing work, use trellis-continue and the current native task facts.

Reuse verified evidence and existing authorization. For a clear, low-risk, reversible, authorized, immediately verifiable request, follow the taskless route in workflow.md. Intake ends when the request reaches its appropriate phase; do not repeat session initialization or conduct a second requirements or planning workflow here.

## Start the task

1. Inspect only evidence that can change the goal, scope, acceptance criteria, constraints, or route. Ask the user only for missing intent or a material user choice; use the project's decision method when needed.
2. Create a Trellis task when the work needs a persistent route, coordination, or review:

       python3 ./.trellis/scripts/task.py create "<title>" --description "<summary>"

3. Initialize an ordered phase route that includes Goal Exploration and Requirements Confirmation Phase, then only the later phases the task needs:

       python3 ./.trellis/scripts/task.py phase init <task> --task-kind <analysis|implementation|combined> --complexity <simple|standard|complex> --project-context <new|existing> --phase-ids <ordered-phase-ids>

4. Load trellis-goal-exploration-and-requirements and its workflow.md. Record the current goal, scope, acceptance, constraints, evidence, and unresolved user decisions in the task artifacts.
5. Obtain explicit user confirmation of the current requirements artifact revision before leaving Goal Exploration and Requirements Confirmation Phase. This confirmation does not approve a solution or authorize implementation.

Follow the active phase Skill after Goal Exploration and Requirements Confirmation Phase. Decision Space Construction and Consolidation Phase organizes material choices; Solution Design and Convergence Phase resolves decisions and accepts an analysis outcome or implementation contract. Task Implementation and Test Verification Phase requires a separate explicit authorization recorded through Trellis CLI. Delivery Review and On-Site Closeout Phase reviews delivery and controls task completion or cancellation.

Use repository evidence for facts and user input for user-owned decisions. Keep questions focused on unresolved choices, and keep artifacts limited to information needed for the route and acceptance.
