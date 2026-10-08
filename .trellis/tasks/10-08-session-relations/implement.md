# Execution Plan v1

Remain planning until this task's sealed revision is explicitly approved as part of the four-task bundle. Native approve/start records each task's own approval; root approval alone is insufficient.

1. Load trellis-before-dev and applicable core SDK, Channel, filesystem-safety, release and unit-test specs. Preserve unrelated edits, use the existing beta branch, no implementation/check workers.
2. Add the minimal relation store/common writer/public query and readiness confirmation, with regressions for persistence order/failure, concurrency, dedup/retry, conflict/cycle, isolation/descendants and cleanup/restart.
3. Use isolated TRELLIS_CHANNEL_ROOT fixtures; clean every fixture in finally. Verify rm/prune/create --force retain the ordinary relation file. No actual paid workers or user store mutation for tests.
4. Run pnpm lint, pnpm typecheck, pnpm test, pnpm build, pnpm release:check; exercise packed public exports/CLI.
5. Commit/push pennix/v0.7-beta, run official paired core/CLI beta release, verify CI and registry exact versions/dependency/dist-tag. Record commit/version in execution evidence.
6. Root coordinator handles system and seven consumer updates and second checkout fast-forward. Native owner verifies installed sessions command; preserve metadata and user config on rollback.
7. Remove only registered temporary artifacts; commit/record owner verification and native archive/journal after bundle integration.

Baseline: 4c23b6edcc4188be247cce0a8f3ef94700e5165d / 0.7.0-beta.39. Material behavior/owner/risk/acceptance discoveries return to planning and fresh approval.
