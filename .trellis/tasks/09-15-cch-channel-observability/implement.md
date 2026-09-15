# Implementation Plan

## Current Status (2026-09-15)

The owner/session projection, durable `session_bound` event, worker reducer
history, project-bucket worker selection, and read-only `task progress` command
are implemented. `task progress` reports only direct active task records;
archived tasks are historical and do not inflate the current plan. JSON mode
keeps update notices on stderr so machine consumers receive parseable stdout.
Focused tests and the CLI regression suite pass locally; release, installation,
and CCH live-pane verification remain pending.

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
6. [ ] Run package dry run, commit and publish the Trellis fork, reinstall it,
   and complete CCH live-pane verification.

Rollback is a normal package rollback: old consumers ignore the optional owner
field and new event; no event history rewrite is permitted.
