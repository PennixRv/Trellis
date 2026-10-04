# Execution evidence

Implementation authorized by the root task. Changes are limited to native worker
configuration and bundled/current guidance, with a local formal-handoff contract
published by Marketplace. Root and component historical records are preserved.

GitNexus complete impacts: `buildCodexArgs` exact/CRITICAL, 127 impacted;
`buildWorkerEnv` exact/CRITICAL, 237 impacted, 170 direct, 44 processes, 19 modules.
Both reported to the user. No partial result accepted. Full regression passed:
core 409 passed/1 skipped; CLI 2209 passed/2 skipped. Lint and typecheck exited 0.

Beta release requires fresh bilingual changelogs and docs navigation. Existing
docs-site has six unrelated modified historical changelogs; use a detached clean
worktree at advertised origin/main for these release assets. This necessary
release work preserves the dirty files and introduces no new root branch.

Initial detect-changes did not cover indexed symbols. Refreshed the existing
index with native analyze --index-only, then reran: 10 files, 4 symbols,
buildCodexArgs/buildWorkerEnv and two worker guidance sections, no partial output.
The graph's low change verdict does not waive the earlier CRITICAL impact;
complete source regression remains the validation basis.

Marketplace `a56a265` and bilingual docs `70c5eda` pushed first. Existing six
docs-site modifications preserved after moving its pointer to the published
release-docs commit. Installed CLI, project consumers and owner closure pending.

## Final delivery correction

Marketplace's first workflow commit `a56a265` was rejected by native integrity
verification because its index digest was stale. The corrected source was pushed
at `01aeef87a504bfaf6f9242887bf1e9a60294035f`; the workflow digest is
`4599e2743270da553a25d65509e7a16043b1254e59cb3167afb043315c8ff013`, and the
four existing planning/integrity tests pass. Owner acceptance was then recorded
in Marketplace commit `2412dfd5b6547ec2d70a79cac7bf7f6dea3fc4ba`; this exact SHA
is pinned as the Trellis `marketplace` submodule.

Published Trellis `v0.7.0-beta.29` at `025f1da7c77c4e9426bf3dc5eca4824d3e79104b`
passed Actions run `37180148626`; both CLI/core packages are visible on npm.
The source checkout and seven consumers were natively updated and workflow
verification passed. No additional CLI release was needed for the Marketplace
gitlink and consumer-only cleanup.

A tracked project-local `.trellis/agents/subnode.env` contained only obsolete
hook-disable variables and was no longer present in current templates. It has
been removed from this source project's active files; the generated hash receipt
is left to its native owner and no history was rewritten. Active templates,
worker guidance, and the selected workflow contain no memory-base integration;
archived tasks, workspace journals, and historical migration manifests remain
intact.

## Owner closure

The tracked project-local `.trellis/agents/subnode.env` deletion, generic worker
guidance, native beta.29 provenance and Marketplace pin `2412dfd5` are ready for
owner commit. `task.py validate` passes after replacing an oversized context
entry with two curated specs. Final `trellis workflow --verify` passes at native
beta.29, and `trellis update --dry-run` reports already current while preserving
the unrelated `.opencode/package.json` deletion. All seven project roots pass
their native workflow provenance check at the intended selected source/ref.
