# Implementation Plan

## Ordered steps

1. Confirm the current Trellis branch, task metadata, applicable CLI specs, template registration, and GitNexus impact/search limitation.
2. Edit only the three common method templates; preserve existing gates and keep operational prose free of upstream provenance.
3. Regenerate or update the native template hash/registry through the repository's supported mechanism.
4. Run focused template/regression tests, lint, typecheck, and the relevant package checks.
5. Run Trellis quality checks and inspect the final diff for scope, wording, and generated-consumer consistency.
6. Commit and push the source branch, cut the next approved beta release using the native release process, and update the installed global Trellis package.
7. Update the root coordination project through `$pennix-trellis-project-update`, verify the materialized templates and workflow behavior, and record the exact source/release/gitlink evidence.

## Validation

- `pnpm lint`
- `pnpm typecheck`
- focused CLI template and regression tests
- full required package test suite from the release checklist
- released `trellis --version` and template hash/render check
- native project update followed by root integration verification

## Rollback points

- Before commit: discard only the three template edits and generated hash changes.
- After commit before release: revert the source commit.
- After release: publish the repository's native correction release if required; do not hand-edit installed templates.
- After project update: use the native Trellis update/revert path and verify no unrelated asset changed.
