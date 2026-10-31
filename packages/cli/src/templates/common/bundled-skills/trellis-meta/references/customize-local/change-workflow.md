# Change Local Workflow

Read the installed project's .trellis/workflow.md before changing phase activities, route guidance, or platform entry points.

## The five business phases

1. Goal exploration and requirements
2. Decision space construction and merging
3. Solution design and convergence
4. Task implementation
5. Delivery review and closeout

Each phase has its own Skill and workflow diagram. Keep their activities distinct. Trellis CLI owns task lifecycle and phase state; do not encode a second route in a Skill, Hook, or command.

Phase 1 requires explicit user confirmation of the current requirements revision before the route enters phase 2 or 3. Phase 3 acceptance and implementation authorization are separate. Phase 4 follows the authorized contract. Phase 5 reviews the current delivery and handles task completion or cancellation. Routes may skip phases when the task record contains sufficient reason and evidence.

## Change workflow assets

| Goal | Edit point |
| --- | --- |
| Change phase activities or transitions | .trellis/workflow.md and the matching phase Skill |
| Change cross-component routing | .trellis/workflow.md and pennix-workflow-routing |
| Change phase status or acceptance | Trellis CLI task workflow contract and tests |
| Change host context injection | Relevant Hook or plugin |

Keep workflow-state phase identifiers aligned with Core and the current task record. Hooks surface state; they do not authorize or accept work. After a shared change, inspect host commands and prompts for stale instructions.
