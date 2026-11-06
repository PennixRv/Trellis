# Teamwork state-machine closure design

## Authority and boundary

Root task: `teamwork-audit-findings-convergence`.

Accepted contract revision: `b71b074b8cd40ce567c6cdaabb5730dfb3b5d065d8d58f801ef4b830a326856e`.

Implement in the Trellis `v0.7.1` maintenance branch. Core owns durable domain facts and legal transitions. The CLI coordinator owns batch admission, provider supervision, FIFO dispatch, waiting, retries, reconciliation, receipt creation, and reservation release. The main Agent waits for the single foreground coordinator invocation and reviews its terminal evidence afterward. Teamwork teammate delegation is disabled for this task.

## Finding map

| Finding | Contract to implement |
| --- | --- |
| F1 | Recover success only when receipt, batch terminal, plan identity, all assignment states, leases, and projection are consistent; otherwise reconcile and retain reservation. |
| F2 | Revalidate task, phase, route, and input revisions before every new attempt; stop admission on staleness and settle queued assignments explicitly. |
| F3 | Separate report content rejection from report storage/read errors; uncertain I/O after provider side effects must reconcile instead of redispatching work. |
| F4 | Stop admission on cancel/deadline; settle undispatched work with explicit non-success reasons and retain capacity until all active provider terminals are confirmed. |
| F5 | Do not cap same-process host waits with an arbitrary continuation count. A continuation that requests another provider work round and every full retry share the frozen finite retry budget; the current production continuation only waits on the same process and does not consume that budget. |
| F6 | Track every active slot's wait/continuation promise in the coordinator event loop so other slots, FIFO refill, deadline, and cancel continue to progress. |
| F7 | Keep derived attempt identities within the Core/artifact schema for every valid assignment ID and retry index. |
| F8 | Recover a missing receipt after terminal persistence only when all plan, assignment, disposition, terminal, lease, and projection facts agree; use a stable idempotency key. |
| S1 | A valid `blocked` report fails only its assignment without ordinary retry; continue the frozen FIFO queue and finish with `SETTLED_WITH_FAILURE`. |
| S2 | Name continuation according to production behavior: wait on the same process and frozen deadline, with no new prompt or deadline extension. |
| S3 | Keep Session `done`/`turn_finished` waits for interactive Session workflows; managed batch waits on the foreground coordinator. |
| S4 | Document the Agent's action beside each receipt: review `ALL_ACCEPTED`, do not phase-accept `SETTLED_WITH_FAILURE`, and stop dispatch/retry/cleanup for `RECONCILIATION_REQUIRED`. |

## Integration order

1. Core transition validation and reducer tests.
2. CLI plan freshness, coordinator settlement/recovery, artifact error classification, retry budget, and FIFO event loop.
3. Production runtime adapter behavior and deterministic child-process tests.
4. Bundled Teamwork Skill, teammate role card, and template distribution tests.
5. Package checks, artifact verification, beta release, CI/npm verification, exact Pennix install, and post-install verification.

The `blocked` outcome is assignment-terminal, not batch-terminal. It releases only that assignment's slot; the coordinator continues FIFO work and cannot return `ALL_ACCEPTED`. Any unresolved provider, projection, receipt, or reservation fact remains in `RECONCILIATION_REQUIRED`.

## Explicit exclusions

No detached daemon, second runtime store, Agent-controlled scheduling, host-wide hard gate, new profile option, cross-repository host change, stable `latest` release, or beta-to-main port is part of this task.
