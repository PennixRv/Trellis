# Design: controlled Codex hook compatibility update

## Decision

Extend the existing `analyzeChanges` classification path. For exactly one path, `.codex/hooks/inject-workflow-state.py`, detect the historical Pennix hook by its dispatch-mode helper and exact pre-ambiguity guards. When all required sentinels are present, produce a merged desired content value that inserts only the missing ambiguity projection and candidate header. Classify that file as an automatic template update.

## Safety contract

- Do not replace the file with the generic template: its Pennix dispatch-mode behavior remains intact.
- Do not migrate a hook that already contains ambiguity handling, lacks the Pennix helper, or does not contain both exact historical insertion points.
- Let ordinary auto-update backup creation, dry-run behavior, chmod, and hash persistence perform the write. Unknown modifications stay conflicts.

## Verification

Use the existing update integration fixture to simulate the old hook and prove automatic update, preservation of the Pennix helper, idempotence, hash update, and that an unrelated edit remains protected. Keep the existing Python runtime test for resolver-to-breadcrumb ambiguity projection.
