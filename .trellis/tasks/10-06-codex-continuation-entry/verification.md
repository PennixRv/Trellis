# Source verification

2026-10-06: pnpm lint/typecheck/build pass. Core 409 passed/1 existing skip; CLI 2,209 passed/2 existing skips. Native fresh temporary Codex init emitted updated start/continue/bootstrap and template-hash entries; update --dry-run reports already up to date. The smoke checker initially assumed the wrong hash JSON shape (files/root); corrected after inspecting actual __version=2/hashes. No product failure resulted.

GitNexus pre-edit CRITICAL renderer blast radius was respected by limiting changes to descriptions. detect_changes via native MCP returns all 24 changed symbols/9 files, no partial/truncated result, low reported risk. Its zero affected edges does not replace source caller confirmation and generated-asset tests. Bootstrap UNKNOWN was resolved by confirming the real append site and generated output. CLI's summary omits symbols in presentation, so complete MCP response was used; an unsupported limit argument was corrected against actual tools/list schema.

Paired release target from native computeNext: 0.7.0-beta.32. Existing release checks confirm matching source versions/packed core dependency; manifest and bilingual changelogs are prepared. Final published and landed pins will be appended after deployment.
