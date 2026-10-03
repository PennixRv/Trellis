# Source quality gate

2026-10-03. Implementation gate passed; release/installed acceptance remains pending.

- Focused: core runtime 29 passed; CLI wait/warning 34 passed.
- Full: core 409 passed, 1 existing skipped; CLI 2209 passed, 2 existing skipped. lint, typecheck and build passed.
- No source dependencies, reducer, event filter, scheduler or provider changes. Existing exact author/kind/to behavior is exercised by the full suites.
- Regression covers supervisor killed/error/crashed, subnode done, synthesized error, ordinary 503 exclusion, peer done exclusion, all targets once, default/explicit barriers, old terminal touched after barrier, pending timeout, incompatible filters and Commander argv. Core replay checks monotonic snapshots across a same-id respawn.
- GitNexus refreshed before edits. Wait and core watch impact are CRITICAL; the exact registration UID query was UNKNOWN and was followed by file inspection and full native MCP change analysis. CLI detect-changes rendered only 10 flows; native MCP returned all 256, 3 symbols / 11 tracked files, no partial/truncated result. This is broad registry impact, not a low-risk claim. The scoped diff plus complete CLI/core quality gates address it.
- verify-packed-cli passed against beta.25 build; pack listing contains bundled references. Fresh /tmp native init generated the worker selector and schema-2 receipt; subsequent update --dry-run reported already up to date. Smoke assertion was corrected to use the actual hashes key (no product fault).
- Docs en/zh beta.26 and shared navigation check passed; docs commit 63aa93a is pushed before source gitlink.
- CI pair publication, exact beta.26 packed verification, installation, real historical single/multi waits and consumer receipts will be appended before closure.
