# Technical Design: Subnode Completion Contract

## Boundary

The gap is role-specific rather than a general Channel lifecycle failure:
generic workers intentionally retain a reusable process after a completed turn,
while `subnode` promises a one-shot evidence handoff. The implementation must
specialize only the `subnode` role.

## Design

1. The core worker reducer will interpret an ordinary `done` event as terminal
   only when the latest `spawned.agent` is `subnode`. It preserves the existing
   generic-worker rule and preserves a completed subnode result across a later
   cleanup `killed` event in historical logs.
2. The CLI supervisor will expose a completion-only shutdown path. It closes
   the provider process with the existing graceful ladder but does not append a
   `killed` event. The stdout adapter path invokes it only after persisting a
   subnode's `done` and corresponding `turn_finished` events. The inbox watcher
   is aborted at the same point.
3. The subnode role and coordinator procedure will say that the worker's final
   assistant reply is the short Channel delivery. The supervisor owns the
   durable `message` / `done` projection, so a worker must not invoke
   `trellis channel send`.

## Compatibility

- No event kind or report schema changes.
- Generic workers stay reusable after a normal turn.
- Older subnode logs replay as `done` when they emitted ordinary `done` before
  later cleanup, preserving their semantic result without rewriting JSONL.
- A subnode killed before normal completion remains `killed` or `crashed`.

## Risks And Rollback

- The completion path is limited to an existing agent name and uses the
  existing process termination ladder; no new process-control mechanism is
  introduced.
- If regression tests expose a provider shutdown ordering issue, revert the
  role-specific completion call while retaining the documentation correction;
  do not change generic worker semantics.

## Bug Analysis And Prevention

- **Category:** B — cross-layer contract, with D — test coverage gap. The
  durable reducer encoded reusable-worker semantics while the subnode role and
  coordinator procedure promised one-shot terminal delivery; no regression
  covered their interaction with idle cleanup.
- **Confirmed scope:** (1) a completed subnode was reduced as idle and later
  shown as `killed`; (2) the role used a Channel CLI command as report
  transport even though its default storage lies outside Codex
  `workspace-write`. The Codex adapter's existing final-reply projection is
  the correct transport.
- **Rejected hypothesis:** the historical `degradation` worker timed out and
  did not create a report, but other workers in that Channel wrote their task
  artifacts successfully. It is not evidence of a general subnode read-only or
  report-write defect.
- **Prevention:** reducer, supervisor, and template regression tests now cover
  the role-specific path; the channel code-spec records the terminal and
  transport contracts. No generic-worker behavior, sandbox setting, or new
  lifecycle/event abstraction is needed.
- **Release follow-up:** the successful `0.6.36` npm package omitted its own
  manifest because `release.js` only checked prior published gaps. Restore the
  no-migration entry in this release and require the computed next-version
  manifest before any release work begins.
