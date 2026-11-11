# Continue Current Task

Resume from the active Trellis task and its current phase. The task record and phase route are authoritative; do not infer the phase from artifact presence or session history.

## Load current context

    python3 ./.trellis/scripts/get_context.py

## Read the phase route

    python3 ./.trellis/scripts/get_context.py --mode phase

Follow the active phase breadcrumb to the matching bundled phase Skill and its workflow.md. Use the task CLI to inspect or change phase state. A resume does not itself accept an artifact, grant authorization, or move the task.

Task lifecycle status and business phase are separate. A planning task may remain in Goal Exploration and Requirements Confirmation Phase, Decision Space Construction and Consolidation Phase, or Solution Design and Convergence Phase. `in_progress` marks authorized Task Implementation and Test Verification Phase; `completed` and `cancelled` are terminal lifecycle states. Delivery Review and On-Site Closeout Phase remains explicit.

## Phase operations

Resume the known unfinished action first. Reassess auxiliary methods only when the problem, phase, or available capabilities have changed; reuse still-valid Skill bodies and decisions. Select relevant host-declared methods directly, or use an available workflow router for unclear combinations. Do not restart discovery, preload a collection, infer paths from old summaries, or repeat settled questions. Auxiliary methods do not change task state or action permissions.

Use the native task CLI for phase artifact revisions, acceptance, evidence-backed skips, waiting, blocking, resuming, returning to an earlier phase, route changes, implementation authorization, completion, and cancellation. Read task.py help for current arguments. Do not create a second status record or use formal session handoff to resume task work.
