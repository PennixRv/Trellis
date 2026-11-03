# Teamwork Runtime

`trellis teamwork` provides durable coordination sessions and teammate processes. Its session lifecycle is independent of the Trellis task lifecycle and phase route. A session may be associated with a task, but it never owns task status, phase state, or phase acceptance.

## Local surfaces

| Surface | Purpose |
| --- | --- |
| `~/.trellis/teamwork/<project>/<session>/events.jsonl` | Durable Teamwork Session event log. |
| `.trellis/agents/teammate.md` | Generic behavior card loaded for a teammate. |
| `.trellis/agents/teammate-profiles.json` | Provider and execution profiles. |
| `.trellis/config.yaml` (`teamwork.*`) | Teammate concurrency and process guard settings. |
| `packages/core/src/teamwork/` | Reusable Teamwork Session event and storage APIs. |
| `packages/cli/src/commands/teamwork/` | CLI commands, provider adapters, and process supervision. |

The storage root defaults to `~/.trellis/teamwork`; `TRELLIS_TEAMWORK_ROOT` overrides it. The project bucket defaults to a key derived from the current working directory; `TRELLIS_TEAMWORK_PROJECT` overrides that key.

## Ownership

- Trellis Core owns reusable Teamwork Session event, storage, and coordination contracts.
- The Trellis CLI owns command handling, teammate process supervision, and task-bound batch artifacts.
- The active Trellis task remains the source of truth for task and phase state. Teamwork dispatch and reports may bind to its current phase and revisions; Teamwork does not write phase acceptance.
- Accepted reports remain task evidence. Temporary batch data may be removed when the batch settles. Teamwork Session event logs follow their own lifecycle.
- Host capabilities must pass the configured capability check before batch execution. A provider contract or fixture alone does not establish that a host is available.

## Configuration

The project configuration supports `teamwork.teammate.max_concurrency` and `teamwork.teammate_guard.idle_timeout`, `max_live_teammates`, and `non_batch_reserved`. Defaults and CLI overrides are defined by the current Trellis CLI; read `packages/cli/src/commands/teamwork/teammate-config.ts` before changing them.

## Related entry points

Use the bundled `trellis-teamwork` Skill for command usage and teammate coordination. Use `trellis workflow` and the active task record for workflow behavior. Do not route task or phase transitions through a Teamwork Session.
