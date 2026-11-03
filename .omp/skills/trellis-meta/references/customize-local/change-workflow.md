# Change Local Workflow

Read the installed project's .trellis/workflow.md before changing phase activities, route guidance, or platform entry points.

## Business phases

- Goal Exploration and Requirements Confirmation Phase
- Decision Space Construction and Consolidation Phase
- Solution Design and Convergence Phase
- Task Implementation and Test Verification Phase
- Delivery Review and On-Site Closeout Phase

Each phase has its own Skill and workflow diagram. Keep their activities distinct. Trellis CLI owns task lifecycle and phase state; do not encode a second route in a Skill, Hook, or command.

The Goal Exploration and Requirements Confirmation Phase requires explicit user confirmation of the current requirements revision before the route enters Decision Space Construction and Consolidation Phase or Solution Design and Convergence Phase. Acceptance in Solution Design and Convergence Phase does not grant implementation authorization. Task Implementation and Test Verification Phase follows the authorized contract. During Delivery Review and On-Site Closeout Phase, review the current delivery and handle task completion or cancellation. Routes may skip phases when the task record contains sufficient reason and evidence.

## Change workflow assets

| Goal | Edit point |
| --- | --- |
| Change phase activities or transitions | .trellis/workflow.md and the matching phase Skill |
| Change cross-component routing | .trellis/workflow.md and pennix-workflow-routing |
| Change phase status or acceptance | Trellis CLI task workflow contract and tests |
| Change host context injection | Relevant Hook or plugin |

Keep workflow-state phase identifiers aligned with Core and the current task record. Hooks surface state; they do not authorize or accept work. After a shared change, inspect host commands and prompts for stale instructions.
