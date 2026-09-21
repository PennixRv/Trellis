# External Lifecycle Research and Adopted Decisions

Research date: 2026-09-14. The external references below were read as design
comparisons, not copied implementations. The goal is to identify guarantees
that fit the existing Trellis event log and artifact helper without creating a
second runtime system.

## References

| Reference | Verified design signal | Decision for Trellis |
| --- | --- | --- |
| LangGraph durable execution: https://docs.langchain.com/oss/javascript/langgraph/durable-execution | Checkpoints persist resumable thread state; a separate store serves cross-thread data. Durable execution also requires explicit replay/idempotency handling. | Keep Channel events as the runtime source of truth and task artifacts as the evidence source. Do not conflate a worker checkpoint with an accepted finding. |
| Temporal child workflows: https://docs.temporal.io/child-workflows | A parent explicitly chooses child completion/close behavior and can await child state. Child execution is a distinct lifecycle from the parent. | Require the coordinator to observe the worker terminal projection before recording a disposition. A report is not a terminal event. |
| Temporal activity execution: https://docs.temporal.io/activity-execution | Failure, timeout, cancellation, retry, and heartbeat are separate execution concerns. | Retain Trellis timeout and kill recovery. Do not add heartbeats while the current process model has no durable lease consumer. Retries remain explicit new subnode assignments. |
| AutoGen termination with intervention: https://microsoft.github.io/autogen/dev/user-guide/core-user-guide/cookbook/termination-with-intervention.html | Runtime termination conditions are handled by the runtime and can stop execution independently of conversational text. | Treat `done`, `error`, `killed`, and `crashed` worker projections as lifecycle facts; never infer completion from a final message alone. |
| CrewAI hierarchical process: https://docs.crewai.com/en/learn/hierarchical-process | A manager delegates work and validates results; delegation and result validation are separate concerns. | Keep assignment, execution, evidence validation, and coordinator disposition as separate steps owned by the appropriate layer. |
| OpenHands Task Tool Set: https://docs.openhands.dev/sdk/guides/task-tool-set | A parent receives a structured task observation with task id and status; a task can be resumed by id, while the documented tool is synchronous and parent-blocking. | Retain Trellis asynchronous event waiting and add a durable read-only worker projection. Do not copy synchronous parent blocking or conversation persistence into Channel. |

These references converge on explicit state transitions, durable observations,
and an orchestrator-owned result decision. They do not justify a global lease
service, a scheduler, model-confidence thresholds, cryptographic hashes, or a
new permission model for this task.

## Current Trellis Evidence

- `packages/core/src/channel/api/workers.ts` already projects worker state from
  the durable event stream and supports terminal inclusion.
- `packages/cli/src/commands/channel/supervisor/shutdown.ts` synthesizes a
  terminal event when a provider exits without one, so recovery can be based on
  the same projection.
- `packages/cli/src/commands/channel/wait.ts` already provides event-driven
  barriers and replay. It remains the notification/wait path; a worker query is
  only a terminal-state read and must not replace the live wait protocol.
- The existing live-worker guard counts reservations and terminal states. The
  subnode procedure previously hardcoded `--max-live-workers 8`; the ordinary
  runtime default remains 6.
- `subnode_artifact.py` already binds a report to an immutable brief and
  rejects symlinked or misplaced artifacts. It did not bind the brief's worker
  handle to its subnode id and did not record a create-once coordinator
  disposition.

## Adopted Lifecycle

```text
brief prepared
  -> worker spawned/running
  -> coordinator waits on durable terminal event
  -> report pending review
  -> coordinator validates report and source/protected-target checks
  -> one disposition: accepted | rejected | deferred
```

The following states are intentionally not added: a worker-owned completion
state, automatic retry, background scheduler, lease/heartbeat state, or a
second cross-process registry. A terminal worker without a valid report is a
recovery case. A valid report without a terminal worker observation remains
pending. An explicit retry gets a new subnode id and brief; it never rewrites
the old assignment.

The implementation adds only two durable affordances:

1. `trellis channel workers <name> --include-terminal --json` exposes the
   existing core worker projection to the coordinator.
2. `subnode_artifact.py disposition` validates the report and writes one
   create-once `disposition.json` beside it, recording the coordinator's
   outcome, terminal observation, required independent checks, and reason.

The disposition is a decision record, not a replacement for Channel events or
Trellis task facts. The coordinator must obtain its terminal lifecycle and
sequence from the worker projection first; the helper records that observation
but does not pretend to inspect an unrelated channel store.

The procedure's resource and lifetime defaults are now project-configurable
under `channel.subnode`: `max_live_workers`, `idle_timeout`, `timeout`, and
`warn_before`. Explicit flags still win, guard environment variables retain
their existing override behavior, and missing configuration uses code defaults
for subnodes without changing ordinary workers.

## Explicitly Not Adopted

- No automatic OpenViking recall, capture, or MCP/tool isolation for subnodes;
  the role environment only disables the automatic memory flow.
- No global worker claim database. The immutable brief plus worker-handle
  identity check is enough for the current bounded procedure.
- No arbitrary handoff/report size change, SHA/hash requirement, confidence
  threshold, or strict access-control layer.
- No assumption that every external framework's persistence or retry policy is
  appropriate for Trellis.
