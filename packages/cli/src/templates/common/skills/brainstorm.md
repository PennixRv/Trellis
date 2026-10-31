# Trellis Brainstorm

Use this entry skill for a new request that needs a Trellis task. For a clear, low-risk, reversible, authorized, immediately verifiable request, follow the taskless route in workflow.md.

## Start the task

1. Inspect only repository evidence that can change the goal, scope, acceptance criteria, constraints, or route. Ask the user when intent or a material choice remains unclear.
2. Create a Trellis task when the work needs a persistent route, coordination, or review:

       {{PYTHON_CMD}} ./.trellis/scripts/task.py create "<title>" --description "<summary>"

3. Initialize an ordered phase route that includes phase 1 and only the later phases the task needs:

       {{PYTHON_CMD}} ./.trellis/scripts/task.py phase init <task> --task-kind <analysis|implementation|combined> --complexity <simple|standard|complex> --project-context <new|existing> --phase-ids <ordered-phase-ids>

4. Load trellis-goal-exploration-and-requirements and its workflow.md. Record the current goal, scope, acceptance, constraints, evidence, and unresolved user decisions in the task artifacts.
5. Obtain explicit user confirmation of the current requirements artifact revision before leaving phase 1. This confirmation does not approve a solution or authorize implementation.

Follow the active phase Skill after phase 1. Phase 2 organizes material choices; phase 3 resolves decisions and accepts an analysis outcome or implementation contract. Implementation requires a separate explicit authorization recorded through Trellis CLI. Phase 5 reviews delivery and controls task completion or cancellation.

Use repository evidence for facts and user input for user-owned decisions. Keep questions focused on unresolved choices, and keep artifacts limited to information needed for the route and acceptance.
