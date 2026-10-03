# Fix worker-terminal waiting without author aliases

## Goal

Fix explicit worker lifecycle waiting for worker and supervisor terminal events; preserve generic author filters, publish beta.26 and consume all initialized projects.

## Requirements

- Preserve exact-author semantics for legacy event wait/from filters.
- Add explicit --workers lifecycle selection by reusing the public core watchWorkers projection; ordinary adapter errors and peer turn completion must not count as terminal.
- Support single-worker and --all waits, durable after-seq barriers, timeout diagnostics and incompatible event-filter rejection.
- Update the shipped subnode procedure and command reference; no new reducer, scheduler, polling loop, dependencies, model changes or core public API.
- Publish CLI/core beta.26 by the existing CI-only flow; update the lifecycle catalog, installation, seven initialized consumers and user static docs under their owners.

## Acceptance Criteria

- [ ] Supervisor killed/error/crash, subnode done, adapter-error exclusion and multi-worker all regression checks pass.
- [ ] Legacy author/kind/to filtering, barrier replay and timeout remain covered; workers mode rejects ambiguous event-filter combinations.
- [ ] Lint, typecheck, build, full tests, impact/change analysis and native installed single/multi-worker historical terminal replay pass.
- [ ] beta.26 is public for both packages, installed and consumed without changing project workflow choices; source/task/release records are pushed and archived.

## Notes

- Root coordination task: 10-02-trellis-subnode-terminal-wait. User authorized full delivery on 2026-10-03. Root stays main; this owner uses fix/subnode-terminal-wait based on pennix/v0.7-beta, then fast-forwards the release branch.
