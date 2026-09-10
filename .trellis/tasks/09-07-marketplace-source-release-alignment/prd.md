# Align Marketplace source and release v0.6.22

## Goal

Ship the existing Pennix `codex-subnode-channel` workflow as a reproducible
Trellis `v0.6.22` release combination.

## Requirements

- The Marketplace Git source recorded by Trellis must be `PennixRv/marketplace`.
- Marketplace and Trellis must publish the same compatibility tag, `v0.6.22`.
  Marketplace remains a Git registry: its `index.json` schema version is not a
  package release version.
- The Trellis CLI and core packages must retain their existing shared-version
  and CI-only publishing contracts.
- A user-level caller can pin the selected workflow as
  `gh:PennixRv/marketplace#v0.6.22`.
- Preserve all pre-existing uncommitted Trellis changes and do not alter the
  built-in `native` workflow default.

## Acceptance Criteria

- [ ] `marketplace` points at a commit reachable from `PennixRv/marketplace`
  `main` and tagged `v0.6.22`.
- [ ] `.gitmodules` names `https://github.com/PennixRv/marketplace.git`, and a
  fresh recursive clone can materialize the recorded Marketplace Gitlink.
- [ ] CLI and core package versions, the Trellis tag, and the Marketplace tag
  are all `v0.6.22` at their respective release commits.
- [ ] The release checks, targeted tests, package artifact check, and a fresh
  pinned-workflow `trellis init --codex` smoke test pass.
- [ ] The npm packages are published only by the existing GitHub Actions path.
