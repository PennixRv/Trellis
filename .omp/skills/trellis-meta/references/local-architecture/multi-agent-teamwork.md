# Teamwork Runtime

`trellis teamwork` provides durable coordination sessions and teammate processes. Its session lifecycle is independent of the Trellis task lifecycle and phase route. A session may be associated with a task, but it never owns task status, phase state, or phase acceptance.

## Local surfaces

| Surface | Purpose |
| --- | --- |
| `~/.trellis/teamwork/<project>/<session>/events.jsonl` | Durable Teamwork Session event log. |
| `.trellis/agents/teammate.md` | Generic behavior card loaded for a teammate. |
| `.trellis/agents/teammate-profiles.json` | Schema-2 professional profiles and named execution candidates. |
| `.trellis/agents/profiles/*.md` | Six professional role cards combined with the common card. |
| `.trellis/teamwork.json` | Coordination mode and member-count defaults. |
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

The schema-2 `.trellis/teamwork.json` owns mode member defaults, mode concurrency limits, and the shared live-process budget and reservation. Defaults are members 1/3/3, concurrency 8/3/3, live budget 8, and reservation 0. YAML retains `teamwork.teammate_guard.idle_timeout`; legacy YAML capacity applies only before schema-2 migration and is otherwise ignored with diagnostics. Runtime `maxConcurrency` is a resolved value, not an independent configuration. Read `coordination.ts` and `teammate-config.ts` before changing this policy.

`teamwork config` resolves project defaults. `teamwork plan` freezes profile,
configuration, instructions and evidence into schema-2 plan/brief artifacts;
`teamwork batch --task` connects the foreground coordinator to Codex app-server,
Claude CLI, Copilot ACP or DSH ACP. Claims and content reports are schema 2.
An unresolved batch keeps a durable project capacity reservation, including
after coordinator exit. The guard and session cleanup preserve that evidence.
Role read-only and history-use requirements are behavioral contracts; runtime
capabilities do not claim filesystem or memory isolation. Teamwork is independent
of Paseo workspaces, Git worktrees and source-writing delegated agents.

## Related entry points

Use the bundled `trellis-teamwork` Skill for command usage and teammate coordination. Use `trellis workflow` and the active task record for workflow behavior. Do not route task or phase transitions through a Teamwork Session.
