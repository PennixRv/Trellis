# Method integration surface

## Confirmed facts

- `brainstorm.md`, `check.md`, and `break-loop.md` are the existing common method entry points; no separate common `writing` or `wayfinder` template exists.
- Trellis already documents decision-grill, evidence units, plan seal, explicit implementation approval, scope discipline, and durable task/spec capture.
- The approved integration therefore needs content reinforcement and cross-links between existing gates, not a new workflow component.
- The current GitNexus index is 43 commits behind HEAD. File-level impact for `brainstorm.md` returned `risk: UNKNOWN` with zero resolved callers, so it is not treated as a clean impact result. Bounded source search and template tests are required counterevidence.

## Decision and stop condition

Use only the three existing common templates and the native template hash/release path. Stop expanding the method surface when each approved method has an explicit placement, preserved owner boundary, and a passing generated-template check.

## Recovery point

After template edits, reread this artifact and the final diff before hash regeneration and release. Record the exact commit, release, installed version, and project update result here before task closure.
