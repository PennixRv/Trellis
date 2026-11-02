# Local Workflow System

The installed project's .trellis/workflow.md is the local workflow source. Read it before changing task guidance or platform entry points.

## Business phases

The workflow keeps its business phases distinct, with separate activities, outputs, and transition conditions:

- Goal Exploration and Requirements Confirmation Phase
- Decision Space Construction and Consolidation Phase
- Solution Design and Convergence Phase
- Task Implementation and Test Verification Phase
- Delivery Review and On-Site Closeout Phase

The task route may skip a phase when evidence shows it adds no value. The Goal Exploration and Requirements Confirmation Phase requires explicit user confirmation of the current requirements revision before the route enters Decision Space Construction and Consolidation Phase or Solution Design and Convergence Phase. Acceptance in Solution Design and Convergence Phase does not grant implementation authorization. During Delivery Review and On-Site Closeout Phase, review the current delivery and handle task completion or cancellation.

Phase identifiers, route revisions, accepted artifact revisions, and authorization are stored and changed through Trellis CLI. Skills and Hooks guide or surface the active phase; they do not create another state source. Formal session handoff is independent of the task and its phases.

## Skill routing and state prompts

Each phase Skill owns its procedure and diagram. The workflow entry routes to the Skill matching the current phase identifier. Component Skills are selected by the work required, not by a fixed phase checklist.

Workflow-state blocks provide per-turn breadcrumbs. Keep their phase identifiers aligned with Core and update host parsers when headings or state tags change. Do not derive a phase from task status or artifact presence when Trellis CLI provides the current route.

## Local modification patterns

| Goal | Edit point |
| --- | --- |
| Change phase activities or transitions | .trellis/workflow.md and the matching phase Skill |
| Change component routing | .trellis/workflow.md and pennix-workflow-routing where applicable |
| Change lifecycle or phase state | Trellis CLI task workflow implementation and its contract |
| Change platform context injection | Relevant Hook or plugin, keeping the Trellis task record authoritative |

After a shared workflow change, inspect relevant platform entry files for stale behavior. Keep phase-specific workflows distinct.
