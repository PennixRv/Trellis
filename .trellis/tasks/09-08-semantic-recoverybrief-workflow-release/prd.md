# Publish semantic RecoveryBrief workflow

## Goal

Update the Pennix Marketplace workflow with bounded semantic RecoveryBrief and formal handoff gates, then publish the matching Trellis release.

## Requirements

- Add a concise RecoveryBrief and formal-handoff contract to the existing
  Pennix Marketplace `codex-subnode-channel` workflow asset.
- Restrict Brief maintenance to task start, checked and recorded material
  semantic changes, explicit pause/formal handoff/finish, and explicit user
  inspection, repair, or force-refresh. Compact lifecycle events, ordinary
  work/resume, checkpoints, and worker reports are not write gates.
- Formal handoff may add the active valid task-local Brief as explicit evidence
  only after a user request; receipt validation and Trellis task restoration
  remain authoritative.
- Publish the immutable Marketplace tag and a coordinated Trellis `v0.6.24`
  release using existing release facilities. Update no unrelated user changes.
- Audit the bundled Skill discovery path. Improve only the intent description
  and workflow routing needed for reliable normal auto-selection; retain
  explicit-only boundaries for mutations and formal handoff.

## Acceptance Criteria

- [ ] The existing workflow asset states the semantic gates, exclusions,
  ownership, and explicit handoff evidence boundary without duplicating a
  user-level coordinator or inventing new runtime behavior.
- [ ] A native `trellis init` smoke test resolves the released Marketplace
  workflow and produces a usable project workflow.
- [ ] Marketplace and parent releases are remotely resolvable as `v0.6.24`.
- [ ] Existing project checks and release checks appropriate to the changed
  assets pass; only task files and intended release files are staged.
- [ ] A fresh native init and an update of the current project both expose
  `trellis-research-record` under Codex's `.agents/skills/`; no custom skill
  dispatcher, Hook, or per-platform registry is added.

## Constraints

- Use the Marketplace workflow's existing native resolver. Do not add a loader,
  CLI flag, Hook, bundled user Skill, task schema, or `.new` behavior.
- The parent working tree already contains unrelated changes and is detached;
  release only through its normal documented path after confirming it supports
  the coordinated asset patch.
