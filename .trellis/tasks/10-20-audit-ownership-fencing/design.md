# Design

## Targets and existing contracts

Baseline: `4b0cd04e1eb8468a6dc40e5a063df4397b6f9adb`, version
`0.7.0-beta.51`, branch `pennix/v0.7-beta`.

Change `packages/cli/src/templates/trellis/scripts/common/ownership_record.py`
and `task_store.py`, their owner-required `.trellis/scripts/common/` source
twins, ownership/regression tests, and the corresponding script/ownership
contracts. Do not edit dist or backups. Native dogfood parity is mandatory.

The mutation guard uses the validated task JSON identity consistently with
`_task_snapshot`, then performs existing path, record and session validation.
No directory-name fallback may hide invalid identity. A rename-specific guard
reuses canonical record discovery and refuses when records exist, before the
rename write plan is applied. This restriction also covers the valid consumer:
there is no record migration, rewritten sealed core, or protocol/schema change.
Normal lifecycle checks continue using the existing consumer policy.

## Regression boundaries

Use native task creation and real integrity-bearing ownership records in
isolated repositories. Cover date-prefixed and unprefixed directories, valid
consumer, stranger, missing identity, malformed task/record, unsafe paths,
ordinary rename, and refusal for every persisted handoff state. Check byte
preservation of all protected files on refusal. Do not alter live ownership.

## Release and integration

The candidate is CLI/core `0.7.0-beta.52`; check version availability before
release. Use the native beta release and CI-only publish chain from
`pennix/v0.7-beta`, including manifest continuity, packed exact core dependency,
fresh-project generated-asset smoke and remote submodule reachability.
Necessary docs-site release notes belong to its current
`codex/chinese-user-templates` branch; push that source before the Trellis
gitlink. No marketplace edit or pointer update is planned. Distinguish the
nested `Trellis/marketplace` checkout from root `pennix-marketplace`; never push
to their upstream remotes by inference.

For the current candidate, add
`packages/cli/src/migrations/manifests/0.7.0-beta.52.json` and docs-site
`changelog/v0.7.0-beta.52.mdx`, `zh/changelog/v0.7.0-beta.52.mdx`, plus its
`docs.json` navigation update. Do not rename old-version files.

Root owns current-machine `pennix update trellis-cli`, native project asset
updates for root/Trellis/CCH, and final gitlink acceptance. Do not copy generated
files to downstream projects manually. Published versions are immutable;
post-release defects require a subsequent patch, not tag replacement.

Completion follows the root design's single completion stop point: source,
formal artifact, managed installation/project materialization, actual applicable
behavior, root integration, then native bookkeeping and final repository checks.
After archive/journal commits, push and verify maintenance HEAD against the live
`origin/pennix/v0.7-beta` tip (ahead/behind 0/0); do the same for any changed
docs-site branch. Root pins the final accepted source HEAD, while release code
and tag commits remain separately recorded. Check tracked and untracked scope;
no omitted files or pending next action may remain. Neither marketplace tree
nor its pointer changes. Missing required evidence is an incomplete checkpoint.
