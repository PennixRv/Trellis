# Continue Current Task

Resume from the active Trellis task and its current phase. The task record and phase route are authoritative; do not infer the phase from artifact presence or session history.

## Load current context

    {{PYTHON_CMD}} ./.trellis/scripts/get_context.py

## Read the phase route

    {{PYTHON_CMD}} ./.trellis/scripts/get_context.py --mode phase

Follow the active phase breadcrumb to the matching bundled phase Skill and its workflow.md. Use the task CLI to inspect or change phase state. A resume does not itself accept an artifact, grant authorization, or move the task.

Task lifecycle status and business phase are separate. A planning task may still be in phases 1–3; in_progress indicates authorized phase 4; completed and cancelled are terminal lifecycle states. Phase 5 review and acceptance remain explicit.

## Phase operations

Use the native task CLI for phase artifact revisions, acceptance, evidence-backed skips, waiting, blocking, resuming, returning to an earlier phase, route changes, implementation authorization, completion, and cancellation. Read task.py help for current arguments. Do not create a second status record or use formal session handoff to resume task work.
