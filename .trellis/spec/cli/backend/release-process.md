# Release Process

> Release, versioning, docs, and npm publishing rules for the Trellis monorepo.

---

## Overview

Trellis publishes three npm packages from one git tag:

| Package | Role | Published by |
|---|---|---|
| `@pennixrv/trellis` | User-facing CLI | GitHub Actions only |
| `@pennixrv/trellis-core` | Programmatic core APIs used by the CLI and external integrations | GitHub Actions only |
| `@pennixrv/trellis-paseo-adapter` | Optional same-host public Paseo SDK adapter (Node >=22) | GitHub Actions only |

All three packages are version-locked and share the exact version and npm dist-tag. The adapter is not a core/CLI dependency; the base packages retain Node >=18.17 support. Publishing runs on Node 22 and includes the adapter's tests and packed public SDK entry points.

---

## CI-only publishing

Official npm publishing must happen through `.github/workflows/publish.yml`.

The workflow uses the repository's `NPM_TOKEN` secret and npm provenance. Do
not publish either package from a local machine.

Do not run `npm publish` or `pnpm publish` locally for official Trellis packages. Local machines may run `pnpm pack`, `release-preflight`, tests, lint, typecheck, and dry-run checks, but not package publication.

If a CI publish looks partial or inconsistent:

1. Inspect the GitHub Actions publish run.
2. Verify public npm visibility:
   ```bash
   npm view @pennixrv/trellis@<version> version dist-tags --json --registry=https://registry.npmjs.org/
   npm view @pennixrv/trellis-core@<version> version dist-tags --json --registry=https://registry.npmjs.org/
   ```
3. Fix the workflow or release scripts.
4. Re-run the CI path or move the tag after the fix when the same version is still the intended release artifact.

Do not compensate by publishing one missing package locally. That creates a release artifact without CI provenance and hides the workflow failure from the next release.

The publish workflow must verify both packages after publish with:

```bash
node packages/cli/scripts/release-preflight.js verify-npm --package all
```

---

## Version invariants

| Invariant | Rule |
|---|---|
| Shared version | `packages/cli/package.json` and `packages/core/package.json` must have the same `version`. |
| Shared tag | Git tag `v<version>` must match both package versions. |
| Shared npm dist-tag | `beta` for `-beta.N`, `rc` for `-rc.N`, `alpha` for `-alpha.N`, `latest` for GA. |
| Source dependency | CLI source depends on core with `workspace:*`. |
| Packed dependency | Published CLI package must depend on `@pennixrv/trellis-core` with the exact release version. |

`packages/cli/scripts/release-preflight.js` is the source of truth for these checks.

Required gates:

```bash
node packages/cli/scripts/release-preflight.js check-versions
node packages/cli/scripts/release-preflight.js verify-packed-cli
node packages/cli/scripts/release-preflight.js publish-plan
```

---

## Branch and release tracks

| Track | Branch pattern | Version pattern | npm tag | Notes |
|---|---|---|---|---|
| Stable | `main` | `X.Y.Z` | `latest` | Patch/minor/major GA releases. |
| Beta | `feat/vX.Y.Z-beta` or equivalent long-lived beta branch | `X.Y.Z-beta.N` | `beta` | Feature incubation. CLI and core both publish beta versions. |
| RC | release candidate branch or the stabilized beta branch | `X.Y.Z-rc.N` | `rc` | Pre-GA validation. CLI and core both publish rc versions. |
| GA promotion | stable release branch / `main` | `X.Y.Z` | `latest` | Promote the release candidate into the stable docs and latest npm tag. |

A new beta cycle starts from the current stable/release baseline and uses the next minor or major version, for example `0.6.0-beta.0` after `0.5.x`. It does not continue an older beta line after that line has moved to RC or GA.

Stable fixes normally flow from `main` to beta/rc by cherry-pick. Beta-only features do not flow back to `main` by cherry-pick; rewrite them as stable-ready commits when needed.

The stable release commands in `packages/cli/scripts/release.js` enforce
`main` and push the branch with the version tag. That branch guard is separate
from `.github/workflows/publish.yml`: the workflow also accepts a pushed `v*`
tag and validates the tagged source without requiring a merge into `main`.
When a task selects a release commit on another existing branch, follow that
task's approved release route and trigger the workflow with its exact tag;
do not use the branch-based stable release command.

---

## Docs-site lifecycle

The docs-site root path holds the current stable docs. Beta and RC content live under `beta/` and `rc/`.

| Transition | Script | When |
|---|---|---|
| Start a new beta | `docs-site/scripts/docs-beta-start.sh` | Before the first `pnpm release:beta` for a new minor/major, for example `0.6.0-beta.0`. |
| Beta to RC | `docs-site/scripts/docs-beta-to-rc.sh` | Before the first `pnpm release:rc`, for example `0.6.0-rc.0`. |
| RC to GA | `docs-site/scripts/docs-promote.sh` | Before `pnpm release:promote`. |

Per-patch beta, RC, or GA releases do not run these lifecycle scripts. They add changelog MDX files, update `docs-site/docs.json`, commit the docs-site submodule first, then bump the submodule pointer in the Trellis repository.

Full docs details live in `.trellis/spec/docs-site/docs/release-lifecycle.md`.

---

## Submodule commit ordering

When a release touches `docs-site`, commit and push that submodule first, then commit its pointer in the Trellis repository. Use the existing branch selected for the docs change; the tagged Trellis commit must reference a docs commit reachable from an `origin` ref.

Correct order:

```bash
cd docs-site
git add . && git commit -m "docs: changelog v<version>" && git push

cd ..
git add docs-site
git commit -m "chore: bump docs-site for v<version>"
git push origin <branch>
```

`packages/cli/scripts/release.js` excludes `docs-site` from automatic pre-release staging so its submodule pointer cannot be hidden inside a generic release commit.

### Contract: every modified submodule must be pushed before the version tag

The tag-triggered `publish.yml` CI runs `git submodule update --init --recursive` against the tagged commit. If **any** submodule pointer references a SHA that doesn't exist on the submodule's remote, CI fails at checkout with:

```
fatal: remote error: upload-pack: not our ref <SHA>
fatal: Fetched in submodule path '<name>', but it did not contain <SHA>. Direct fetching of that commit failed.
```

Verify the submodule pointer before `pnpm release`:

```bash
git submodule foreach 'git fetch origin -q; sha=$(git rev-parse HEAD); \
  git merge-base --is-ancestor $sha origin/main \
    && echo "ok $name" || echo "FAIL $name $sha not on remote"'
```

### Don't: test submodule reachability with `ls-remote`

**Problem**:

```bash
git submodule foreach 'sha=$(git rev-parse HEAD); git ls-remote origin $sha | grep -q $sha && ...'
```

**Why it's bad**: `ls-remote` matches **ref names**, not commits. It finds a SHA
only when that SHA is itself a branch or tag tip. A submodule pointer at any
earlier commit on `main` — which is the normal case, since pointers are bumped
after the submodule moves on — reports `FAIL` while CI fetches it without
trouble. Observed 2026-08-06 while preparing v0.6.13: both submodules reported
`FAIL`, both were reachable.

A check that fails on healthy input is worse than no check. It trains you to
ignore it, which is how the v0.6.4 incident below happens a second time.

**Instead**: fetch, then ask whether the SHA is an ancestor of the remote branch
— that is the same question CI answers when it materialises the pointer.

Any `FAIL` line means the referenced commit is not reachable from a fetched remote branch or tag. Push it to the existing approved branch for that submodule before tagging; do not create or switch branches just to satisfy this check. If the tag was already pushed when you discover the miss, push the submodule commit and re-run the failed CI jobs (`gh run rerun <id> --failed`) — no new tag is needed.

### Contract: the pre-release sweep MUST exclude `.trellis/`

The pre-release `git add` in `release.js` (the `chore: pre-release updates`
commit) **must** exclude `.trellis/` from its pathspec, alongside `docs-site`:

```js
run("git add -A -- ':!docs-site' ':!.trellis'");
```

`.trellis/tasks/` is not gitignored, so a blanket `git add -A` sweeps in any
dirty in-progress task dirs, workspace journal drafts, and runtime artifacts
that happen to be present in the release session. Staging `.trellis/` is only
ever allowed through `common/safe_commit.py`'s precise allowlist (see the
"unscoped `.trellis` staging" bug class in `script-conventions.md`) — never
through a release-time blanket stage.

> **Incident note (2026-06, #303).** A `release.js` pre-release `git add -A`
> that excluded only `docs-site` and the Marketplace checkout (then present)
> swept 6 unrelated in-progress
> community-governance task files into the pre-release commit twice
> (`5ee43ecc`, `ec123deb`). The maintainer had to `git rm --cached` three
> times (`d66405d9`, `81960120`, `3c3219cf`) before finally tracking the
> drafts to stop the bleed (`e83233c9`). The same staging-scope defect also
> lives in `add_session.py` (the #303 body) and in ad-hoc human/AI
> `git add -A`. This contract exists so the release route can never re-open
> that escape hatch. See `script-conventions.md` → "Absolute prohibition:
> never blanket-stage" for the full bug-class writeup.

---

## Manifest continuity across branches

Each release branch maintains its own `packages/cli/src/migrations/manifests/<version>.json`. The CLI update logic walks the manifest chain between `fromVersion` and `toVersion`, so every published version that a user can upgrade through must have a local manifest on the release branch.

When a stable patch manifest is missing from a beta branch:

```bash
git show main:packages/cli/src/migrations/manifests/<version>.json \
  > packages/cli/src/migrations/manifests/<version>.json
git add packages/cli/src/migrations/manifests/<version>.json
git commit -m "chore: restore manifest <version> from main"
```

Restore published manifests deliberately. Do not auto-merge whole manifest directories across release branches, because branch-specific manifests can mention files that do not exist on the other branch.

---

## Release command sequence

The root release scripts delegate to the CLI package:

```bash
pnpm release
pnpm release:beta
pnpm release:rc
pnpm release:promote
```

`packages/cli/scripts/release.js` runs:

1. `check-manifest-continuity`
2. `check-docs-changelog --type beta|rc|promote` for prerelease/promotion tracks
3. CLI build
4. CLI tests
5. pre-release commit excluding `docs-site` and `.trellis`
6. `bump-versions.js <type>` to update both package versions together
7. `release-preflight check-versions`
8. version commit with the version string as the commit message
9. git tag `v<version>`
10. push HEAD to the fully qualified selected branch and the exact release tag
11. GitHub Actions publish workflow builds, tests, packs, publishes, and verifies both packages

The release script does not publish locally. The pushed tag is what starts official npm publication.

Read the branch with `git branch --show-current`, retaining detached-HEAD rejection. `git rev-parse --abbrev-ref HEAD` can return `heads/<branch>` when a tag shares the branch name. Push to `HEAD:refs/heads/<branch>` and only `refs/tags/v<version>`; never create a different branch while recovering a release. If the version commit already exists but publication stopped before the tag push, verify the target version and remote refs before resuming that exact version.

---

## Publish workflow sequence

`.github/workflows/publish.yml` runs on `v*` tag push and GitHub Release publication. It is idempotent for reruns on the same tag.

Required order:

1. install dependencies
2. `release-preflight check-versions --require-tag`
3. `pnpm typecheck`
4. `pnpm build`
5. `pnpm test`
6. `release-preflight verify-packed-cli`
7. `release-preflight publish-plan --github`
8. publish `@pennixrv/trellis-core` if missing
9. publish `@pennixrv/trellis` if missing
10. `release-preflight verify-npm --package all`

Core publishes first because the CLI package depends on the exact core version in the packed artifact.

---

## Artifact verification for release-claimed assets

Any changelog, docs page, or marketplace entry that says a feature is "bundled",
"installed automatically", or "included with Trellis" must be verified against
the built package artifact, not only against the source tree.

Before tagging a release that adds or changes a bundled template, skill,
workflow, hook, script, or generated platform asset:

1. Run the CLI build.
2. Run `npm pack --dry-run --json` from `packages/cli/` and check the expected
   `dist/templates/**` paths are present.
3. Use the built binary (`node packages/cli/bin/trellis.js`) in a fresh temp
   git repository and run the user-facing command that should install the
   asset.
4. Check both the generated files and `.trellis/.template-hashes.json` for the
   expected paths.
5. Run `trellis update --dry-run` from the temp repository and confirm it
   reports the project is already up to date.

This gate is required when docs are updated before or separately from the code
branch that actually adds the distributable files. A source file existing on
another branch, in `marketplace/`, or in a docs submodule is not evidence that
the npm package contains it.

Example for a built-in multi-file skill:

```bash
pnpm --filter @pennixrv/trellis build

cd packages/cli
npm pack --dry-run --json | grep 'dist/templates/common/bundled-skills/<skill>/SKILL.md'
cd ../..

tmpdir=$(mktemp -d /tmp/trellis-release-smoke-XXXXXX)
printf '{"name":"trellis-smoke","version":"0.0.0"}\n' > "$tmpdir/package.json"
git -C "$tmpdir" init -q
(
  cd "$tmpdir"
  node /path/to/Trellis/packages/cli/bin/trellis.js init -u smoke --yes --claude --codex
  test -f .claude/skills/<skill>/SKILL.md
  test -f .agents/skills/<skill>/SKILL.md
  grep -q '<skill>' .trellis/.template-hashes.json
  node /path/to/Trellis/packages/cli/bin/trellis.js update --dry-run
)
```

---

## Pre-release checklist

- [ ] Worktree is clean except intentional release changes.
- [ ] Relevant coding specs have been read.
- [ ] Manifest exists for the target version.
- [ ] English and Chinese docs-site changelogs exist and match 1:1.
- [ ] `docs-site/docs.json` points to the new changelog.
- [ ] Submodule commits are pushed before Trellis repository pointer commits.
- [ ] `node packages/cli/scripts/release-preflight.js check-versions` passes.
- [ ] `node packages/cli/scripts/release-preflight.js verify-packed-cli` passes.
- [ ] Release-claimed bundled assets are verified in `npm pack --dry-run --json` and a fresh temp-directory `trellis init` / `trellis update --dry-run` smoke test.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass or the blocker is recorded.
- [ ] Breaking releases include `migrationGuide` and `aiInstructions` in the manifest.
- [ ] Official package publication is left to CI.

---

## Cross-references

- Core/CLI code ownership and package boundaries: `trellis-core-sdk.md`
- Manifest format and migration types: `migrations.md`
- Docs lifecycle: `.trellis/spec/docs-site/docs/release-lifecycle.md`
- Native dependency policy: `quality-guidelines.md`
