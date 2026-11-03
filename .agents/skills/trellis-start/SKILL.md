---
name: trellis-start
description: "Initializes an AI development session by reading workflow guides, developer identity, git status, active tasks, and project guidelines from .trellis/. Classifies incoming tasks and routes to brainstorm, direct edit, or task workflow. Use when beginning a new coding session, resuming work, starting a new task, or re-establishing project context."
---

# Start Session

Load the current Trellis context and continue from the task record's current phase.

## Load context

    python3 ./.trellis/scripts/get_context.py
    python3 ./.trellis/scripts/get_context.py --mode phase
    python3 ./.trellis/scripts/get_context.py --mode packages

Read the applicable spec indexes before editing code. The active phase breadcrumb names the phase Skill and its workflow.md.

## Route the current request

- No active Trellis task: use the taskless route when the request is clear, low-risk, reversible, authorized, and immediately verifiable. Otherwise create the task with the user's consent and load `trellis-goal-exploration-and-requirements`.
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
