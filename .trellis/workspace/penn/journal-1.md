# Journal - penn (Part 1)

> AI development session journal
> Started: 2026-08-23

---



## Session 1: Codex channel handshake remediation

**Date**: 2026-08-23
**Task**: Codex channel handshake remediation
**Package**: cli
**Branch**: `main`

### Summary

Completed the response-gated Codex app-server initialization handshake and recorded validation evidence. Official publication remains a root-managed CI-only release step.

### Main Changes

- Gated thread/start on a successful initialize response and emitted the required initialized notification.
- Added terminal-state cleanup and focused adapter regression coverage.

### Git Commits

| Hash | Message |
|------|---------|
| `109c9626c0c8ec7fc081cb7e53dca319c11896dd` | (see git log) |
| `ac63532190b3205cc4ed37e388887c85e8b5fe10` | (see git log) |

### Testing

- [OK] Ran targeted adapter tests, lint, typecheck, build, package tests, and commit-hook suites.

### Status

[OK] **Completed**

### Next Steps

- Root repository must arrange CI-only publication, installation, and a fresh-host sentinel before closing Issue 155.


## Session 2: Release configurable subnode lifecycle
<!-- trellis-session: v=2 fp=dab14e3a63ea87a7 -->

**Date**: 2026-09-14
**Task**: Release configurable subnode lifecycle
**Package**: cli
**Branch**: `main`

### Summary

Completed, released, and archived bounded Channel subnode lifecycle remediation.

### Main Changes

- Added role-owned subnode OpenViking environment isolation, durable worker projection, and coordinator disposition.
- Made the subnode worker budget configurable with generated default 8 while ordinary workers retain 6.
- Restored published manifest continuity for 0.6.28 and released CLI/Core 0.6.29.

### Git Commits

| Hash | Message |
|------|---------|
| `93be5259` | feat(channel): harden subnode lifecycle |
| `e9cf0758` | 0.6.29 |
| `a73f7f94` | chore(task): archive 09-14-subnode-lifecycle-remediation |

### Testing

- [OK] pnpm test: core 377 passed, 1 skipped; CLI 1960 passed across 89 files.
- [OK] pnpm lint, pnpm lint:all (0 Python errors; 68 existing warnings), pnpm typecheck, pnpm build, manifest continuity, GitNexus, and npm publication verification passed.

### Status

[OK] **Completed**

### Next Steps

- No active implementation task remains; start the next planned workflow task from a clean main.
