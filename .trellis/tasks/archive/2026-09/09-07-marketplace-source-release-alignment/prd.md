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

- [x] `marketplace` points at a commit reachable from `PennixRv/marketplace`
  `main` and tagged `v0.6.22`.
- [x] `.gitmodules` names `https://github.com/PennixRv/marketplace.git`, and a
  fresh recursive clone can materialize the recorded Marketplace Gitlink.
- [x] CLI and core package versions, the Trellis tag, and the Marketplace tag
  are all `v0.6.22` at their respective release commits.
- [x] The release checks, targeted tests, package artifact check, and a fresh
  pinned-workflow `trellis init --codex` smoke test pass.
- [x] The npm packages are published only by the existing GitHub Actions path.

## Verification

- Marketplace `v0.6.22` is reachable from `PennixRv/marketplace` and the
  current submodule commit remains a descendant of that tag; remote tag
  resolution was checked with `git ls-remote`.
- `.gitmodules` points to `https://github.com/PennixRv/marketplace.git`, and
  the recorded Gitlink is materialized in this checkout.
- Trellis CLI/core release `v0.6.22` and Marketplace tag `v0.6.22` are present;
  the later `v0.6.23+` releases retain the same source alignment.
- The release preflight, package checks, pinned workflow initialization smoke
  test, and the existing GitHub Actions publication path were completed in
  the release history. No local npm publication was used.
