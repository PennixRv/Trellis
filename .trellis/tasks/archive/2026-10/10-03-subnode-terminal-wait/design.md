# Worker-terminal wait design and Planning Seal

2026-10-03, closed. User approval covers the scoped fix, release, installation and consumer convergence.

- Baseline: owner 7a732636, CLI/core beta.25. Branch fix/subnode-terminal-wait, base/release pennix/v0.7-beta.
- Root cause: event wait/from filters exact authors; supervisor terminal events have a different author. Ordinary adapter error can wake event wait without terminating a worker.
- Reuse core watchWorkers (already public) as the sole worker lifecycle source. No core filter/reducer changes. Verified refinement: with explicit sinceSeq, anchor its initial snapshot at that barrier and replay later events once in durable order; without sinceSeq keep the current snapshot.
  Add optional CLI --workers CSV; default waits for the first named terminal worker, --all requires all.
  Only a nonterminal-to-terminal transition after the captured/explicit durable barrier satisfies a target; output is worker JSON with lastSeq, not a report acceptance receipt. Old terminal state touched by a later ordinary error does not satisfy a target.
- Existing event wait stays unchanged. Worker mode rejects from/kind/to/thread/action/include-progress; lifecycle completion is channel state independent of message recipients. Scope/as/after-seq/timeout/all remain valid.
- Changes: core watchWorkers replay and existing runtime test, CLI wait and command wiring, existing wait regression suite, shipped lifecycle-wait examples/command-reference plus owner channel/SDK spec, beta.26 manifest/changelog/version metadata.
- Compatibility: additive opt-in CLI selector; no changes to core SDK exports, event storage, legacy filters, report/disposition, provider or queue behavior.
- Validation: supervisor-only killed/error/crashed, subnode done, nonterminal adapter errors, mixed all, old barrier exclusion, timeout and CLI argv wiring; existing legacy event tests and full owner quality gates.
- Installed integration replays the two real prior killed workers in root's agentmemory-fit-review-20261002 channel using the prior durable barrier 1. Single and multi waits run sequentially; no new dispatch or provider request, no runtime edits or event injection.
- Release: docs-site dual changelogs/navigation pushed first, source and gitlink commit, native release:beta CI pair publish, public verify-npm; Skills catalog exact source installation and native lifecycle CLI upgrade.
- Seven consumers match the beta.25 inventory. Preserve Marketplace codex-subnode-channel ref 1e0af97b in root/FastCtx, native choice in Trellis/Skills and local workflows in CCH/Windsurf. Native update only; no hand-edited receipts/provenance.
- Rollback: scoped revert and native beta.25/catalog reinstall. Unknown public-interface expansion, dependency, source safety regression or concurrent release returns the task to planning.
