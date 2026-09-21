# Beta Reconciliation Matrix

Audit date: 2026-09-21. Target: `pennix/v0.7-beta`.

| Surface | Verified evidence | Disposition |
| --- | --- | --- |
| Upstream beta baseline | `mindfold-ai/Trellis` `feat/v0.7-beta` and `v0.7.0-beta.4` resolve to `be9e19b269c25cb2787489eb81062bf96619442c`; it is a merge parent of Pennix beta release `b7715f99`. | Retained. Beta is rooted in the declared upstream beta, not a partial file copy. |
| Pennix stable contracts | Prior integration matrix in archived `09-21-pennix-v07-beta-integration` maps Pennix lifecycle, channel, handoff, analysis-only, direct-small-work, memory, status, and uninstall/update contracts to beta owners. No core source deletion was found across `packages/cli`, `packages/core`, `.github`, `.gitmodules`, or `marketplace`. | Retained; stable `main` and npm `latest` remain outside this beta release. |
| Task projection | With no session identity and multiple developer-owned resumable tasks, `task.py current --json` returns `unbound_ambiguous`; shared `inject-workflow-state.py` emits its candidates. Root-coordination `no_task` is a different project, not a Trellis task-loss signal. CCH reads independent `trellis task progress --json` counts and must not infer a current binding. | Core behavior already correct; keep ownership boundary explicit. |
| Claude status consumer | `statusline.py` returned no task when `resolve_active_task()` yielded `unbound_ambiguous`, silently losing the core state. | Fixed: render explicit ambiguity and candidate count; focused regression added. |
| npm release preflight | Exact-version `npm view ... version --json` currently returns `["0.7.0-beta.4.pennix.1"]`; preflight accepted only a JSON string and planned duplicate publication. | Fixed: accept only the equivalent single-element array form; regression added. |
| Package/migration assets | `pnpm build` copied templates and manifests; `verify-packed-cli` verifies exact core pin. `0.7.0-beta.5.json`, `.6.json`, and `.7.json` are present; continuity guard passes against published npm versions. | Fixed/verified. |
| Marketplace | Pennix Marketplace gitlink is `ec18dc6fac82a377e50f794652418fa531e9f064`; no Marketplace source changes are needed because the two findings belong to CLI template/release code. | Verified; unchanged. |
| Documentation ownership | Existing `docs-site` pointed to read-only `mindfold-ai/docs`; its release guard requires changelog files and reachable gitlink. Push to upstream was denied. `PennixRv/docs` is now a fork containing `61f6250bdb1a60de126c0a54a5bf0b87cac7e696` with beta.5 English/Chinese changelogs and navigation. | Fixed: switch the submodule URL and gitlink to the Pennix-owned fork before tagging. |
| Release tag isolation | `release.js` used `git push --tags`; beta.5 therefore pushed an unrelated local upstream `v0.7.0-beta.4` tag and started an unwanted workflow. The workflow was cancelled before publish and npm confirms both Pennix packages lack `0.7.0-beta.4`. | Fixed for beta.6 onward: push only `HEAD:<release branch>` and the newly-created `refs/tags/v${version}`; regression added. |

## Validation Completed Before Release

- `pnpm lint`
- `pnpm typecheck`
- `pnpm --filter @pennixrv/trellis lint:py` (0 errors; 68 pre-existing unused-export warnings)
- `pnpm build`
- `pnpm test` (Core: 406 passed, 1 skipped; CLI: 2157 passed, 2 skipped)
- `node packages/cli/scripts/release-preflight.js verify-packed-cli`
- `node packages/cli/scripts/check-manifest-continuity.js`
- `node packages/cli/scripts/check-docs-changelog.js --type beta`
- `pnpm exec vitest run test/scripts/release-staging.test.ts test/scripts/release-preflight.test.ts` (tag-isolation and npm-response regressions)
- `node .gitnexus/run.cjs detect-changes --scope compare --base-ref main --repo .` (beta-vs-main impact: 208 files, 686 symbols, 294 affected flows; critical aggregate risk reviewed against the target functions)

## Release Follow-Up

Beta.6 was published and beta.7 was released after the npm verification normalization. The beta.7 workflow first hit the bounded propagation timeout for the CLI package; a failed-job rerun passed after npm visibility converged. Public npm now exposes both beta.7 packages and the `beta` dist-tag points to beta.7. The stable `latest` dist-tag remains 0.6.45. An isolated consumer installed beta.7 and passed `init --codex --yes`, `update --dry-run`, and `task progress --json`.
