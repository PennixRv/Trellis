# Technical Design

## Boundaries

Trellis remains the owner of task lifecycle, plan sealing, approval, generated asset hashes, release, and project update. Pennix Skills remains the owner of decision-grill and routing policy. The integration is textual guidance in three existing common Skills; it does not import or copy the external fork.

## Method placement

| Template | Method to add | Existing contract to preserve |
| --- | --- | --- |
| `brainstorm.md` | idea/gap → evidence → user decisions → bounded plan → approval | Trellis planning phase, analysis-only exception, native task gates, decision-grill routing |
| `check.md` | changed behavior → evidence → acceptance → findings → targeted correction or replan | quality gate, scope discipline, design findings stop, no silent scope expansion |
| `break-loop.md` | root cause → failed attempts → prevention → systematic expansion → durable capture | five-dimension analysis, confidence handling, task/spec ownership and release authorization |

The new guidance stays short and procedural. It points to the existing task artifacts for durable records and uses the existing decision/replan gates when a finding changes owner, risk, public behavior, release, or acceptance.

## Generation and compatibility

The three files are source templates under `packages/cli/src/templates/common/skills/`. The native template registry and hash manifest remain the only generated-asset authority. After editing, run the repository's template tests and release checks, then update a real project through the native `trellis update` path.

## Rollback

Revert the Trellis source commit and release the next patch/beta only if the release process requires a published correction. Before release, `git revert` restores the previous templates and manifest. Project materialization is guarded by the existing template ownership/hash checks.
