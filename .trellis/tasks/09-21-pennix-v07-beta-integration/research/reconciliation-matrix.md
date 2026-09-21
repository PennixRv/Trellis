# Pennix Capability Reconciliation Matrix

This matrix records the functional Pennix contracts that must survive the
upstream `v0.7.0-beta.4` ownership changes. Historical commits, release
manifests, journals, and task archives are not capability evidence by
themselves.

| Pennix contract | Stable owner | Beta owner / landing | Disposition | Proof |
| --- | --- | --- | --- | --- |
| Pennix package scope and lockstep release | `package.json`, package manifests, release scripts | `package.json`, `packages/{cli,core}/package.json`, beta release scripts | Retain at beta release owners | package/version and release-preflight tests |
| Governed Channel startup, spawn, wait, guards, and Codex routing | Channel CLI and core runtime | `packages/cli/src/commands/channel/**`, `packages/core/src/channel/**` | Retain; beta owns the runtime and its stronger IO/session safeguards | Channel runtime, guard, adapter, wait, and worker tests |
| Managed Codex subnode lifecycle and project assets | bundled skills, `.trellis/agents`, Channel workflow | `packages/cli/src/templates/trellis/agents/**`, Channel bundled skill, Marketplace workflows | Retain at beta template/Channel owners | subnode artifact, Channel routing, and Marketplace template tests |
| Continuation records and resumable ownership | task/session scripts | `continuation_record.py`, `ownership_record.py`, task/session context | Retain at beta lifecycle owners | continuity and ownership tests |
| Sealed handoff and recovery records | handoff/task runtime | beta lifecycle scripts and workflow state contract | Retain; use beta record validation and recovery paths | lifecycle regression and workflow-state tests |
| Analysis-only research/design completion | analysis-only task workflow | task lifecycle and workflow guidance | Retain; no implementation is required for a bounded analysis task | analysis-only task artifacts and regression coverage |
| Unbound active-task projection (Issue 180) | Pennix active-task resolver and Hook | `common/active_task.py`, `common/context_projection.py`, shared Hook | Retain on top of upstream #608; direct session binding stays authoritative and fallback is opt-in | resolver and context-injection regression tests |
| Context projection limits and UTF-8 safety | shared Hook | project-owned `context_projection.py` plus shared Hook delegation | Retain; beta owns one canonical projection implementation | 49 context-injection integration tests |
| Status, telemetry, and cost aggregation | workflow-state Hook and task/session records | beta workflow-state templates and runtime records | Retain at beta state/telemetry owners | state, session, Channel, and regression tests |
| Managed update, conflict detection, and uninstall boundaries | init/update utilities | `managed-paths.ts`, `manifest-prune.ts`, `uninstall-scrubbers.ts` | Retain; beta update safety supersedes old generated-file paths | init/update/uninstall integration tests |
| Direct small work without a task | Pennix workflow templates | core generated workflow plus Marketplace `native`, `tdd`, Channel, and Codex-subnode workflows | Retain as template policy only; escalate on scope, ownership, design, release, credential, or durable-record uncertainty | cross-template direct-small policy test |
| Platform and memory additions | Pennix platform/memory exports | beta core memory/platform owners and CLI `mem` command | Retain where beta has the owner; beta API/export shape wins | core memory and CLI memory tests |
| Guarded `trellis ablate` and lifecycle safety | upstream beta commands and scripts | beta command/lifecycle implementation | Beta-superseded old Pennix behavior where beta has stronger safety | upstream beta suite plus CLI regression tests |
| Historical 0.6 release/task material | old branch task and manifest trees | no beta runtime owner | Intentionally exclude; retain only the active integration task evidence | scope review and clean release continuity |

The matrix is complete at the capability-group level: every row has a beta
owner, a disposition, and an executable proof or an explicit exclusion. A
historical path is not copied unless it is the current owner of a retained
contract.
