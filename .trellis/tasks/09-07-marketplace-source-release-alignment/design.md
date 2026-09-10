# Design

## Boundary

This is a release-alignment task, not a workflow-runtime redesign. The
Marketplace already contains the single registered `codex-subnode-channel`
workflow. No CLI resolver, workflow template, Channel behavior, or native
workflow default changes here.

## Version Model

Marketplace has no package manifest and is consumed by Git ref. Its release
identity is therefore an annotated Git tag. `v0.6.22` denotes compatibility
with the Trellis `v0.6.22` CLI/core pair; `index.json.version: 1` continues to
mean registry schema version only.

The user-level profile uses the immutable source form:

```text
gh:PennixRv/marketplace#v0.6.22
```

The source parser already supports `#ref`, so this task must not add a second
registry mechanism or change the CLI's generic default source.

## Release Shape

1. Correct the Marketplace README origin, commit it, push `main`, and create
   the `v0.6.22` tag/release there.
2. Record the resulting submodule Gitlink and Pennix URL in Trellis.
3. Add the required no-template-change migration manifest for `0.6.22`.
4. Run the existing patch release process. It creates the synchronized CLI/core
   version commit and Trellis `v0.6.22` tag; GitHub Actions performs npm
   publication.

Existing user edits under Trellis `AGENTS.md`, `CLAUDE.md`, `.agents/`, and
`.claude/` are excluded from every staged set.
