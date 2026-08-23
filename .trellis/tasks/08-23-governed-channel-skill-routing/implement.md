# Governed Channel Skill Routing Implementation Plan

## Steps

1. [x] Record the Issue 144 evidence, ownership boundary, and exact profile predicates.
2. [x] Add the profile gate to `SKILL.md`, marking governed routing as the first decision.
3. [x] Mark Pattern B and direct worker examples as non-governed-only, while preserving ordinary Trellis behavior.
4. [x] Add a focused Vitest regression covering the source and resolved bundled-skill output for every platform context.
5. [x] Run the focused test, CLI lint, typecheck, and the relevant template/configurator tests.
6. [x] Run build/template distribution checks so the source is present in `dist` and a temporary initialized project receives the guarded skill.
7. [ ] Update Issue 144 only after all gates pass, commit the component repository, and report the exact commit to the root repository. Do not modify the root submodule Gitlink in this component task.

## Validation commands

```bash
pnpm --filter @mindfoldhq/trellis exec vitest run test/templates/trellis-channel-routing.test.ts
pnpm --filter @mindfoldhq/trellis lint
pnpm --filter @mindfoldhq/trellis typecheck
pnpm --filter @mindfoldhq/trellis exec vitest run test/configurators/platforms.test.ts test/templates/trellis-channel-routing.test.ts
pnpm --filter @mindfoldhq/trellis build
```

## Verification Record

- `npx --yes pnpm@10.32.1 --filter @mindfoldhq/trellis exec vitest run test/templates/trellis-channel-routing.test.ts`: passed, 3/3.
- `npx --yes pnpm@10.32.1 --filter @mindfoldhq/trellis lint`: passed.
- `npx --yes pnpm@10.32.1 typecheck`: passed after the required `trellis-core` build.
- `npx --yes pnpm@10.32.1 --filter @mindfoldhq/trellis exec vitest run test/configurators/platforms.test.ts test/templates/trellis-channel-routing.test.ts`: passed, 59/59.
- `npx --yes pnpm@10.32.1 build`: passed; source and `dist` skill hashes match.
- A temporary Git project initialized with the built CLI received the guarded Codex skill; its `SKILL.md` hash matches the source.
- Full `npx --yes pnpm@10.32.1 test`: 1659 passed, 1 skipped, 2 failed in existing marketplace mirror tests because `marketplace/workflows/native/workflow.md` and `marketplace/workflows/tdd/workflow.md` are absent from this component checkout. These failures do not touch the changed files.

## Gates and stop conditions

- If the bundled source and generated output differ, stop before commit and repair the shared collector path.
- If the profile contract is incomplete or ambiguous, route to no governed implementation path and keep Issue 144 open.
- Do not install a Plugin, change `/home/penn/.codex`, publish npm packages, or update the root repository Gitlink in this task.

## Rollback

Keep the component worktree clean before the task. If tests fail, revert only this task's source/test/docs changes before reconsidering the design; do not reset unrelated component work.
