# Trellis Request Intake

Use this entry skill to route a new request. First check its relationship to the active task: a change to the same goal returns to the earliest affected phase; independent work needs its own intake. Do not put unrelated work into the active task or bypass its ownership and acceptance gates. To resume existing work, use trellis-continue and the current native task facts.

Reuse verified evidence and existing authorization. Follow the taskless route in workflow.md only when all of these are true: the goal is clear; the scope and owner are bounded; risk is controlled; the user has authorized the actual action; success can be verified in the current session; and the work needs no persistent route, coordination, design, review, release, installation, migration, external delivery, or dedicated rollback plan. A bounded irreversible action additionally needs exact target verification, an acceptable recovery or loss boundary, and a stop condition. User authorization alone is not sufficient. Read-only inspection, bounded diagnosis, low-impact native-owner maintenance or cleanup, small single-surface edits, and rerunning existing checks are examples, not an allowlist. Intake ends when the request reaches its appropriate phase; do not repeat session initialization or conduct a second requirements or planning workflow here.

## Start the task

1. Inspect only evidence that can change the goal, scope, acceptance criteria, constraints, or route. Ask the user only for missing intent or a material user choice; use the project's decision method when needed.
2. When the work needs a persistent route, coordination, design, review, release, installation, migration, external delivery, or a durable record, treat it as task-based. If the user did not explicitly ask to create a task, stop before the create command and ask for creation approval. State which taskless condition is not met, the proposed owner/scope/route, and the risk of proceeding without a task. An explicit user request to create or resume a task is already authorization for that lifecycle action only; it does not authorize implementation or delivery:

       {{PYTHON_CMD}} ./.trellis/scripts/task.py create "<title>" --description "<summary>"

3. After creation approval, initialize an ordered phase route that includes Goal Exploration and Requirements Confirmation Phase, then only the later phases the task needs:

       {{PYTHON_CMD}} ./.trellis/scripts/task.py phase init <task> --task-kind <analysis|implementation|combined> --complexity <simple|standard|complex> --project-context <new|existing> --phase-ids <ordered-phase-ids>

4. Load trellis-goal-exploration-and-requirements and its workflow.md. Record the current goal, scope, acceptance, constraints, evidence, and unresolved user decisions in the task artifacts.
5. Obtain explicit user confirmation of the current requirements artifact revision before leaving Goal Exploration and Requirements Confirmation Phase. This confirmation does not approve a solution or authorize implementation.

Follow the active phase Skill after Goal Exploration and Requirements Confirmation Phase. Decision Space Construction and Consolidation Phase organizes material choices; Solution Design and Convergence Phase resolves decisions and accepts an analysis outcome or implementation contract. Task Implementation and Test Verification Phase requires a separate explicit authorization recorded through Trellis CLI. Delivery Review and On-Site Closeout Phase reviews delivery and controls task completion or cancellation.

Use repository evidence for facts and user input for user-owned decisions. Keep questions focused on unresolved choices, and keep artifacts limited to information needed for the route and acceptance.
