---
name: trellis-brainstorm
description: "Guides collaborative requirements discovery before implementation. Creates task directory, seeds PRD, asks high-value questions one at a time, researches technical choices, and converges on MVP scope. Use when requirements are unclear, there are multiple valid approaches, or the user describes a new feature or complex task."
---

# Trellis Brainstorm

Use this entry skill for a new request that needs a Trellis task. For a clear, low-risk, reversible, authorized, immediately verifiable request, follow the taskless route in workflow.md.

## Start the task

1. Inspect only repository evidence that can change the goal, scope, acceptance criteria, constraints, or route. Ask the user when intent or a material choice remains unclear.
2. Create a Trellis task when the work needs a persistent route, coordination, or review:

       python3 ./.trellis/scripts/task.py create "<title>" --description "<summary>"

3. Initialize an ordered phase route that includes Goal Exploration and Requirements Confirmation Phase, then only the later phases the task needs:

       python3 ./.trellis/scripts/task.py phase init <task> --task-kind <analysis|implementation|combined> --complexity <simple|standard|complex> --project-context <new|existing> --phase-ids <ordered-phase-ids>

4. Load trellis-goal-exploration-and-requirements and its workflow.md. Record the current goal, scope, acceptance, constraints, evidence, and unresolved user decisions in the task artifacts.
5. Obtain explicit user confirmation of the current requirements artifact revision before leaving Goal Exploration and Requirements Confirmation Phase. This confirmation does not approve a solution or authorize implementation.

Follow the active phase Skill after Goal Exploration and Requirements Confirmation Phase. Decision Space Construction and Consolidation Phase organizes material choices; Solution Design and Convergence Phase resolves decisions and accepts an analysis outcome or implementation contract. Task Implementation and Test Verification Phase requires a separate explicit authorization recorded through Trellis CLI. Delivery Review and On-Site Closeout Phase reviews delivery and controls task completion or cancellation.

Use repository evidence for facts and user input for user-owned decisions. Keep questions focused on unresolved choices, and keep artifacts limited to information needed for the route and acceptance.
