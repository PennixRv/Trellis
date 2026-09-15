# Implementation Plan

## Current Status (2026-09-15)

The owner/session projection, durable `session_bound` event, worker reducer
history, project-bucket worker selection, and read-only `task progress` command
are implemented. `task progress` reports only direct active task records;
archived tasks are historical and do not inflate the current plan. Its JSON
projection is the fixed lifecycle tuple `planning`, `in_progress`,
`completed`, plus `partial`; JSON mode keeps update notices on stderr so
machine consumers receive parseable stdout.
Focused tests and the CLI regression suite pass locally; release and global
installation are complete. CCH live-pane verification is limited to a real
pane with no same-owner worker currently available.

1. [x] Run the existing typecheck, lint, unit tests, and package checks; record the
   baseline. Run GitNexus impact analysis for `CreateChannelEvent`,
   `createChannel`, `listWorkers`, worker reducer, CLI channel commands, and
   supervisor stdout before edits.
2. [x] Add the owner field to core create types/events, CLI create options, and
   exact list filtering. Add project bucket targeting to the worker CLI.
3. [x] Add the `session_bound` event type and reducer projection. Wire the existing
   adapter `persistSessionId` path to append it while retaining sidecar writes.
4. [x] Add focused event, reducer, API, CLI, project-scope, global-scope, and
   replay tests. Run typecheck, lint, unit tests, and package checks.
5. [x] Run GitNexus `detect-changes`, inspect the final diff, update the Channel
   reference/help documentation.
6. [x] Run package dry run, commit and publish the Trellis fork, and reinstall it.
   A real pane verified the task/session/path projections; CCH fixtures cover
   worker states because no same-owner worker was available for a live
   demonstration.

Rollback is a normal package rollback: old consumers ignore the optional owner
field and new event; no event history rewrite is permitted.
