# Planning Seal

## Decision status

Sealed for implementation under the user's existing full-scope approval. No product, architecture, or scope question remains. Use the next beta version selected by Trellis's native release preflight; do not hard-code a tag before it is checked.

## Locked target and boundaries

- Source owner: `/home/penn/devel/Trellis`, branch `pennix/v0.7-beta`.
- Modify only user-facing text in the seven historical migration manifests named in `prd.md`, plus the required next-version neutral manifest and bilingual release notes.
- Preserve all migration semantics and the beta.21 hash-guarded cleanup. Preserve task/archive records, Git history, native local session history, existing project workflow selections, and all unrelated working-tree state.
- Release the paired CLI/core packages through the repository's GitHub Actions tag flow. Upgrade through Pennix's native lifecycle owner and native-update all seven existing consumers.
- The root coordination repository remains on `main` and has no remote; commit locally without claiming a push.

## Implementation and verification path

Use the existing manifest and release tooling. Verify JSON/schema and manifest continuity; compare the seven manifests to HEAD and prove only approved text fields changed. Run CLI/core tests, lint/typecheck/build, release preflight, packed artifact inspection, GitHub Actions and npm visibility checks, then update and verify each approved consumer.

## Stop/rollback

Stop before publication on version/tag collision, unexpected dirty state, any migration semantic change, failed checks, or a consumer conflict. Before publishing, revert only this task's metadata/docs edits. After a public tag exists, do not rewrite it; correct via the next beta release. No replacement memory/knowledge-base component is in scope.
