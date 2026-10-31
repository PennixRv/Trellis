# Start Session

Load the current Trellis context and continue from the task record's current phase.

## Load context

    {{PYTHON_CMD}} ./.trellis/scripts/get_context.py
    {{PYTHON_CMD}} ./.trellis/scripts/get_context.py --mode phase
    {{PYTHON_CMD}} ./.trellis/scripts/get_context.py --mode packages

Read the applicable spec indexes before editing code. The active phase breadcrumb names the phase Skill and its workflow.md.

## Route the current request

- No active Trellis task: use the taskless route when the request is clear, low-risk, reversible, authorized, and immediately verifiable. Otherwise load trellis-brainstorm to create a task and initialize a phase route.
- Task with no initialized route: inspect its current requirements, choose the applicable ordered phases with evidence for omissions, then initialize the route through task.py phase init.
- Phase 1: load trellis-goal-exploration-and-requirements. Do not leave until the user confirms the current requirements artifact revision.
- Phase 2: load trellis-decision-space-construction-and-merging.
- Phase 3: load trellis-solution-design-and-convergence. An accepted implementation contract still requires separate implementation authorization.
- Phase 4: load trellis-task-implementation and the target repository's applicable specs.
- Phase 5: load trellis-delivery-review-and-closeout.

Task lifecycle status does not replace the business phase route. Use Trellis CLI to inspect or change task and phase state.

## Spec context

    {{PYTHON_CMD}} ./.trellis/scripts/get_context.py --mode packages
    cat .trellis/spec/guides/index.md

Read the package and layer indexes relevant to the requested changes, then follow their references.
