# beta.4 owner ledger

## Baseline

- Source baseline: `be9e19b269c25cb2787489eb81062bf96619442c` (`0.7.0-beta.4`).
- Implementation branch: existing `v0.7.1` only.
- Root task remains the cross-repository owner. This task owns Trellis Core/CLI source, tests, templates and component receipts.
- Marketplace source and root gitlinks are outside this task.

## Retained beta.4 owners

| Area | Existing owner and caller | Decision |
| --- | --- | --- |
| Durable Channel JSONL, sequence, lock, replay and idempotency | Core `internal/store/events.ts`, API mutations, CLI store readers | Retain as the only source of durable Channel facts. Extend with typed opt-in facts only. |
| Existing Channel process projection and host observation | Core `worker-state.ts`, `api/workers.ts`, CLI guard/supervisor | Retain lifecycle projection and pid observation. Add protected activity as an orthogonal projection. |
| Provider process lifecycle | CLI adapter registry and supervisor | Retain adapter/supervisor ownership. Add the common teammate contract and fail-closed capability checks. |
| Context and role loading | CLI `agent-loader.ts`, `context-loader.ts`, template `getAllAgents()` | Retain loader path. Add provider-neutral `teammate` materialization and digest checks. |
| Normal one-shot and task lifecycle | CLI `run.ts`, native templates, Trellis task scripts | Retain unchanged. Parallel behavior remains opt-in and does not become a task or Marketplace workflow. |

## Old fork evidence and disposition

| Old fork path | Evidence | Disposition |
| --- | --- | --- |
| Channel event/reducer hardening and session relation records | Pennix beta.54 changes under Core Channel and their focused tests | Re-evaluate against beta.4 contracts; retain only facts that add durable correlation or replay safety without a second lifecycle. |
| CLI guard, process observation, process identity and supervisor protections | Pennix beta.54 Channel CLI changes and tests | Retain the useful host-local safety and liveness checks; migrate capacity/lease semantics into the shared guard and coordinator owner. |
| Provider profile resolution and role/profile assets | Old fork profile/identity/template additions | Migrate to provider-neutral `teammate` role/profile/config resolution. Keep legacy inputs read-only when they are unambiguous; remove provider-hardcoded public defaults. |
| Task-owned artifact validation | Old fork artifact script and its fixtures | Reimplement the validated identity/path/report/disposition rules in the CLI owner using task-owned canonical paths; do not preserve a second task lifecycle or ledger. |
| FIFO, slot refill, bounded retry and main-command wait | Old fork runtime behavior and historical tests | Retain as coordinator FSM behavior. Timeout continuation stays in the same attempt; complete failure gets a new attempt only within the frozen per-work budget. |
| Parallel-specific workflow and manual lifecycle instructions | Old fork workflow/Marketplace entries | Remove from the new source. Put fixed-plan submission, program-owned waiting, receipts and artifact boundaries in the existing Channel Skill/template path. |
| Recursive native delegation or business-source write access | Old fork/provider-specific behavior where present | Remove. Runner capability policy must disable native delegation and protect product source, configuration and Git state. |
| Git worktree/branch isolation for teammate execution | Historical fork design | Remove from this implementation. Shared worktree is allowed only with enforced read-only protected targets and artifact-only writes. |

## Baseline receipts

- Core tests: `399 passed`, `1 skipped` out of `400`.
- CLI tests after workspace install and Core build: `2048 passed`, `2 skipped` out of `2054`; the three `platforms` failures disappeared after building CLI `dist`.
- Remaining baseline template failure is caused by the protected Marketplace/docs-site checkout content differing from beta.4 gitlink expectations; its source is owned by the separate Marketplace task.
- Core and CLI typecheck passed. Core and CLI lint commands completed without diagnostics.

## Impact evidence before edits

- `ChannelEvent`: 52 impacted symbols, 15 processes, critical risk.
- `reduceWorkerRegistry`: 17 impacted symbols, 7 processes, critical risk.
- `resolveWorkerGuardConfig`: 5 impacted symbols, 3 processes, high risk.
- `loadAgent`: 5 impacted symbols, 3 processes, high risk.

These paths will be extended with backward-compatible fields or new modules, and their existing normal-path tests remain required.

## Current changed-path ownership and deterministic checks

| Exact changed paths | Owner | Deterministic check |
| --- | --- | --- |
| `packages/core/src/channel/index.ts`; `packages/core/src/channel/internal/store/events.ts`; `packages/core/src/channel/api/coordination.ts`; `packages/core/src/channel/internal/store/coordination.ts` | Core Channel event/API/projection owner | `packages/core/test/channel/coordination.test.ts`, existing Core Channel suite, Core typecheck/lint/build; replay and batch scoping are covered by projection tests. |
| `packages/cli/src/commands/channel/index.ts`; `packages/cli/src/commands/channel/artifact.ts`; `packages/cli/src/commands/channel/coordinator.ts`; `packages/cli/src/commands/channel/profiles.ts`; `packages/cli/src/commands/channel/teammate-adapters.ts`; `packages/cli/src/commands/channel/teammate-config.ts`; `packages/cli/src/commands/channel/teammate-launch.ts` | CLI Channel command, artifact, coordinator, profile and adapter owners | `channel-artifact`, `channel-config-profile`, `channel-coordinator`, and `channel-teammate` tests; CLI typecheck/lint/build; full CLI suite. The real host entry remains fail-closed. |
| `packages/cli/src/templates/common/bundled-skills/trellis-channel/SKILL.md`; `packages/cli/src/templates/common/bundled-skills/trellis-channel/references/teammates.md`; `packages/cli/src/templates/trellis/config.yaml`; `packages/cli/src/templates/trellis/index.ts`; `packages/cli/src/templates/trellis/agents/teammate.md`; `packages/cli/src/templates/trellis/agents/teammate-profiles.json` | CLI common/Trellis template source owner | `platforms.test.ts`, `templates/trellis.test.ts`, template registration and agent/profile schema assertions. The complete bundled Skill directory is copied by the existing template path. |
| `packages/cli/src/templates/copilot/prompts/parallel.prompt.md` (removed) | Copilot prompt template owner | Confirmed `collectCopilotTemplates()` consumes shared commands, not `getAllPrompts()`; the unconnected prompt was not generated and contained a conflicting manual worktree scheduler. `copilot.test.ts` asserts it is absent from discoverable prompt names. |
| `packages/cli/src/templates/trellis/agents/implement.md`; `packages/cli/src/templates/trellis/agents/check.md` | Trellis implementation/check agent template owner | `templates/trellis.test.ts` checks task progress, design comparison, risk-proportional checks, added cases, and reruns. |
| `packages/core/test/channel/coordination.test.ts`; `packages/cli/test/commands/channel-artifact.test.ts`; `packages/cli/test/commands/channel-config-profile.test.ts`; `packages/cli/test/commands/channel-coordinator.test.ts`; `packages/cli/test/commands/channel-teammate.test.ts`; `packages/cli/test/configurators/platforms.test.ts`; `packages/cli/test/templates/trellis.test.ts`; `packages/cli/test/templates/copilot.test.ts` | Owning Core/CLI package test suites | Core and CLI Vitest suites; focused tests cover state transitions, cross-batch identity, FIFO/retries/timeouts/reconciliation, artifact trust boundaries, provider contracts including implicit-memory isolation, and template routes. |
| `.trellis/spec/cli/backend/commands-channel.md` | Trellis CLI Channel contract spec | `task.py validate` plus implementation/design review against the Core and CLI tests. |
| `.trellis/tasks/10-24-parallel-channel-teammate-runtime/prd.md`; `.trellis/tasks/10-24-parallel-channel-teammate-runtime/design.md`; `.trellis/tasks/10-24-parallel-channel-teammate-runtime/implement.md`; `.trellis/tasks/10-24-parallel-channel-teammate-runtime/implement.jsonl`; `.trellis/tasks/10-24-parallel-channel-teammate-runtime/check.jsonl`; `.trellis/tasks/10-24-parallel-channel-teammate-runtime/task.json`; `.trellis/tasks/10-24-parallel-channel-teammate-runtime/execution.md`; `.trellis/tasks/10-24-parallel-channel-teammate-runtime/research/owner-ledger.md` | Native Trellis component task | `task.py validate`, PRD/design/plan alignment review, and this execution checkpoint. Task state remains managed by the native task entry point; do not edit `task.json` manually. |

The parent checkout also reports `docs-site` and `marketplace` gitlink changes.
Those protected checkout states predate this component implementation and are
outside its changed-path set. The Marketplace checkout contains an unrelated
untracked task artifact; neither nested checkout is modified by this task.
