# Trellis implementation order

1. Run GitNexus upstream impact for supervisor and Codex environment/config chokepoints.
2. Edit the shared child environment/config boundary and its focused tests.
3. Update bundled guidance/marketplace contract and version migration assets.
4. Run focused Vitest, lint/typecheck/build and full GitNexus detect-changes.
5. Run beta release preflight, commit and push the owner branch, then install the paired release and validate a real main/child launch.

Do not alter unrelated providers, root workflow state, or the official Cognee plugin source.

2026-10-04 live verification found that quoted plugin segments in native `-c`
do not affect the installed plugin. The adapter now uses the unquoted dotted
key, matching the native inventory probe. This requires beta.28 after the
already-published beta.27; all consumers must receive beta.28 before acceptance.
CLI full suite: 2209 passed, 2 skipped. Parent coordinator owns the real child
and installed release acceptance; the task remains in progress until those pass.
- beta.28 pre-commit graph review: native impact reported CRITICAL, with broad upstream over-approximation; textual corroboration identified the adapter dispatcher and its tests as the actual buildCodexArgs callers. Full native MCP detect_changes was rerun after index refresh (complete response, no partial/truncated flags); its zero changed-symbol result does not establish no effect. The reviewed diff changes one native configuration literal. CLI 98 files/2209 passed/2 skipped, lint/typecheck/build passed, and the native plugin inventory probe confirmed the parser contract. Index process coverage warnings remain a tool limitation, not an acceptance claim.
