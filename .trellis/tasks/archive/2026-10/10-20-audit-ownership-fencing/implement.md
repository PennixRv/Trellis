# Implementation plan

1. Present these source artifacts in the root final review. After explicit
   approval of this exact source task and release scope, use native plan
   seal/approve with the returned revision, then native start. Keep both branch
   fields and the actual worktree on `pennix/v0.7-beta`.
2. Load applicable CLI backend/unit-test specs before product edits. Inspect
   every caller of the existing mutation guard and rename command. Use trusted
   deployed graph tooling only when applicable; otherwise record `not_run` and
   bounded source/caller/test evidence. Do not bootstrap a graph.
3. Add failing native-fixture ownership and rename regressions, fix canonical
   identity lookup and write-before-refusal boundaries, and sync the owner-
   defined dogfood source twins. Preserve all unrelated task state.
4. Run ownership and relevant regression tests, then `pnpm lint`,
   `pnpm typecheck`, `pnpm test`, `pnpm build`; require Python compatibility and
   byte parity. Record actual commands, failures and results.
5. Review applicable spec updates and precise dirty paths; present the commit
   batches before executing them. Do not sweep task/runtime files into release
   staging. Archive and journal bookkeeping follow work commits.
6. Add the next-version migration manifest and required bilingual docs-site
   changelog through the existing release contract. Validate and push any
   changed docs-site commit first. Verify no marketplace diff or pointer change.
7. Run native release preflight and beta release from `pennix/v0.7-beta` only.
   Verify both npm packages, beta tags, exact packed dependency, source commit,
   tarball contents and fresh init/update smoke. Publication stays in CI.
8. Root performs managed update and the three explicitly scoped project updates.
   Require per-finding, installation/materialization and integration evidence;
   finish this source task with native archive/journal, then commit/push all
   in-scope bookkeeping. Verify final HEAD equals live origin/pennix/v0.7-beta
   with ahead/behind 0/0, tracked/untracked scope resolved, changed docs-site
   synchronized, and both marketplace pointers unchanged. Root pins this final
   accepted HEAD and records release commits separately, without a new delivery.

Stop on unexpected dirty state, identity failure, target/version conflict,
test/release failure, or any required marketplace modification. Preserve the
actual checkpoint, do not reset user work, overwrite tags or invent rollback.
