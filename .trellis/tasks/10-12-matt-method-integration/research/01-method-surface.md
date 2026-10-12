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

## Delivery evidence

- The approved template changes were merged to `pennix/v0.7-beta`; the release commit is `ced81464d6d861ac8a07e4ad766c0409ff25fd84`, tag `v0.7.0-beta.46`, and both the core/CLI package versions are `0.7.0-beta.46`.
- Release workflow `38245061829` completed successfully. Version alignment, build, typecheck, Core/CLI tests, packed CLI pin verification, publication and public npm verification all passed. The release added manifest `src/migrations/manifests/0.7.0-beta.46.json` with no migrations.
- The installed native Trellis CLI was upgraded through Pennix lifecycle and reports `0.7.0-beta.46`; its component verify returned `match` with no failures. The root coordination project was updated through native `trellis update --create-new`, which refreshed three common Trellis Skills and `.trellis` version/hash metadata while preserving tasks/spec/workspace. A subsequent `trellis update --dry-run` reported `Already up to date`.
- The root offline integration gate completed with 8 passed, 0 failed, 0 blocked, 0 skipped and 0 not-run. The project runtime state was unchanged by the offline gate.
