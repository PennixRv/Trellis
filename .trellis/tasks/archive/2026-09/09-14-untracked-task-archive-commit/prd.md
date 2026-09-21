# Fix untracked task archive commit

## Goal

Ensure task archive auto-commit handles a previously untracked task directory without passing its removed source path to git commit.

## Requirements

- Preserve the existing narrow archive commit scope: the archived destination,
  source-side deletions for a tracked task, and explicitly changed child task
  records only.
- When a task directory was never tracked, do not pass its removed source path
  to the explicit `git diff` or `git commit` pathspec.
- Keep the tracked-task phantom-delete repair, branch validation, archive move,
  ownership behavior, and unrelated staged changes unchanged.
- Apply the identical Python change to the dogfood and shipped template trees;
  do not edit generated `packages/cli/dist` content.
- Add a regression through the real stamped-template `task.py archive` command.
- Ensure the release pre-commit sweep recursively excludes `.trellis/**`, so
  active task artifacts cannot enter `chore: pre-release updates`.
- Release the marketplace compatibility tag at the same version as the Trellis
  CLI/core release; use its existing annotated-tag convention without creating
  an unrelated marketplace content commit.

## Acceptance Criteria

- [x] Archiving a previously untracked task succeeds with auto-commit enabled,
  creates a narrow archive commit, and leaves no source task path behind.
- [x] The existing tracked-task source-deletion and unrelated-change tests still
  pass.
- [x] Dogfood and shipped Python script trees remain byte-identical.
- [x] The release pre-commit staging route leaves `.trellis/tasks/**` unstaged.
- [x] Marketplace carries the matching annotated release tag on a commit
  reachable from `origin/main` before the Trellis release tag is created.
- [x] Focused archive test, lint, typecheck, relevant package tests, and
  GitNexus changed-scope analysis pass before release.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

## Verification

- `task-archive.integration.test.ts` and `release-staging.test.ts`: 7/7.
- CLI full suite: 90 files, 1,962 tests; lint, typecheck, build, and Python
  lint completed without errors; dogfood/template scripts are byte-identical.
- GitNexus changed-scope analysis reports the release path and archive helper
  as the only affected symbols; npm publish workflow `34836501634` succeeded.
- `@pennixrv/trellis`, `@pennixrv/trellis-core`, and marketplace all carry
  `0.6.30`; the host CLI/core and the root project's managed task store were
  updated through their native npm and `trellis update --skip-all` paths.
