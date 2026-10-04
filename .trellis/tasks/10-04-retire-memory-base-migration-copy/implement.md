# Implementation and acceptance plan

1. Confirm branch `pennix/v0.7-beta`, clean release worktree, current task binding, and owner release state. Record that product-name matches are limited to the seven identified manifest files; exclude task/archive and Git history from the active scan.
2. Replace only retired-product prose in beta.16, beta.18, beta.21, beta.22, beta.23, beta.27, and beta.28 manifests with concise neutral migration descriptions. Preserve version, schema, all migration entries, target paths, and hashes. Add the next release manifest with no retired-product names and the required neutral bilingual docs changelog.
3. Validate JSON and manifest continuity. Diff-check all seven historical manifests against HEAD and prove every non-text field is unchanged; confirm beta.21's safe-delete path and allowed hash remain exact. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, release preflight, package build/pack checks, and the native release preflight before publication.
4. Publish the next beta through `pnpm release:beta` and GitHub Actions only. Verify both npm package versions, the beta dist-tag, and that the published CLI package contains the sanitized manifests.
5. Upgrade the installed CLI through the Pennix native lifecycle owner, then update and verify the seven consumer roots in `research/consumer-rollout.md`. Preserve both custom workflow refs, native selected workflows, protected files, and unrelated dirty state.
6. Run the final active-source, package, installed-collection, and consumer scan. Archive this owner task, commit and push its evidence, and update the root task with exact release and consumer refs. Root remains on `main`; do not claim a root push because it has no remote.

## Stop conditions

Stop before release if the next version/manifest is already claimed, the release branch or tag disagrees, docs-site has unrelated dirty content that cannot be safely isolated, a non-text manifest field changes, tests/preflight fail, or any consumer update would overwrite protected local state. Do not remove the beta.21 compatibility cleanup or broaden the sweep to Git history and archived task records.
