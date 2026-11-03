# Start Session

Load the session's Trellis context. Route a new request through `trellis-request-intake`; resume existing work through `trellis-continue` and the task record's current phase. Do not repeat initialization when context and ownership have already been established.

## Load context

    python3 ./.trellis/scripts/get_context.py
    python3 ./.trellis/scripts/get_context.py --mode phase
    python3 ./.trellis/scripts/get_context.py --mode packages

Read the applicable spec indexes before editing code. The active phase breadcrumb names the phase Skill and its workflow.md.

## Route the current request

- New request: use `trellis-request-intake` to determine whether it changes the current goal, is independent work, or qualifies for the taskless route. Reuse existing authorization and evidence.
- Task with no initialized route: inspect its current requirements, choose the applicable ordered phases with evidence for omissions, then initialize the route through task.py phase init.
- Goal Exploration and Requirements Confirmation Phase: load `trellis-goal-exploration-and-requirements`. Do not leave until the user confirms the current requirements artifact revision.
- Decision Space Construction and Consolidation Phase: load `trellis-decision-space-construction-and-merging`.
- Solution Design and Convergence Phase: load `trellis-solution-design-and-convergence`. An accepted implementation contract still requires separate implementation authorization.
- Task Implementation and Test Verification Phase: load `trellis-task-implementation` and the target repository's applicable specs.
- Delivery Review and On-Site Closeout Phase: load `trellis-delivery-review-and-closeout`.

Task lifecycle status does not replace the business phase route. Use Trellis CLI to inspect or change task and phase state.

## Spec context

    python3 ./.trellis/scripts/get_context.py --mode packages
    cat .trellis/spec/guides/index.md

Read the package and layer indexes relevant to the requested changes, then follow their references.
