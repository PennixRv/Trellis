# Design: sanitize released migration metadata

## Owners and scope

The Trellis CLI package owns the seven versioned JSON manifests under `packages/cli/src/migrations/manifests/`. Change only user-facing `description`, `changelog`, and `notes` text that names retired external memory/knowledge-base products. Preserve Git history and the migrations' compatibility purpose.

## Contracts and data flow

`src/migrations/index.ts:loadManifests` loads every bundled manifest; update planning and migration prompts consume their descriptions and changelogs. GitNexus impact on `loadManifests` reports HIGH risk, 11 impacted symbols, 1 update process, and a graph 70 commits behind HEAD. The target function and runtime loading behavior remain untouched; this change only edits JSON text fields. Direct impact on a JSON path is not represented in the graph.

The beta.21 `safe-file-delete` entry must remain byte-for-byte equivalent in all non-text fields: retain its migration type, `.trellis/agents/subnode.env` target, exact allowed hash, and safety behavior. It provides a narrowly hash-guarded cleanup path for existing consumers.

## Release and rollout

Determine the next available beta with the repository's native release preflight. Add the required new-version manifest and paired English/Chinese changelog using neutral language. Validate source manifests and continuity, run the repository quality checks, publish the CLI/core pair through the GitHub Actions tag workflow, and verify both npm artifacts and the beta dist-tag. Upgrade the native CLI through its owner lifecycle, then natively update all seven approved consumers without changing selected workflows or local policy.

## Failure handling

Published npm versions and Git tags are immutable. If the metadata, package contents, or consumer verification is wrong, stop before consumer rollout when possible; after publication, correct with the next beta rather than rewriting a published version. Preserve unrelated worktree state and do not stage task records in the release pre-sweep.
