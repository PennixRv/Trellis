# Implementation order

1. Run `trellis-before-dev` for `packages/cli` template/command layer; read `packages/cli/backend` channel specs, the current `subnode.env`, agent loader, spawn/supervisor path and template parity tests.
2. Replace the OpenViking environment contract in the canonical generated template with `HINDSIGHT_DISABLED=1`; update only the matching active workflow explanations. Search the active source/templates/tests for remaining OV subnode isolation references; do not alter archived history.
3. Add or adjust the smallest existing template and supervisor tests to prove the child-only override and untouched parent. Do not add production Hindsight dependency to the Trellis CLI.
4. Complete source implementation before running tests, as required by the parent task. Then join the unified test phase: Trellis relevant suite plus isolated pinned Hindsight v0.10.1 hook/MCP child-vs-coordinator matrix.
5. Commit and push to the existing `pennix/v0.7-beta`; publish the normal beta release, verify npm/source parity, then update root consumer assets with the native `pennix-trellis-project-update` skill after Pennix and Trellis releases are pinned.

## Stop conditions

- The pinned Hindsight integration no longer honors `HINDSIGHT_DISABLED` for either hook or MCP, or `subnode.env` does not reach the Codex child as expected.
- The template is not actually Trellis-owned/generated or the proposed edit would overwrite project-specific user content.
- A source change would be needed outside the identified Trellis CLI/template/docs boundary.

If a stop condition occurs, return exact evidence to the parent planning gate; do not add a new Hindsight CLI dependency or blanket-disable the coordinator.
