# Teamwork architecture

Teamwork is the public CLI and bundled-Skill surface for Trellis Channel collaboration. It does not add a Trellis task workflow or task lifecycle.

## Ownership and names

- The public CLI root is `trellis teamwork`, registered by `packages/cli/src/commands/channel/index.ts`. There is no `trellis channel` alias.
- Core event validation, replay, APIs, and durable storage remain the upstream Channel domain under `packages/core/src/channel/`. Internal source paths and persisted Channel names remain unchanged.
- The bundled entry is `trellis-teamwork`, sourced from `packages/cli/src/templates/common/bundled-skills/trellis-teamwork/` and copied through the existing common Skill distribution.
- `.trellis/agents/teammate.md` is the single generic behavior card. `.trellis/agents/teammate-profiles.json` selects provider, model, reasoning effort, and runner options; it does not create role-specific instructions.

## Batch and host boundary

The batch coordinator, artifact validation, retry decisions, report checks, and terminal receipt belong to the Teamwork CLI. The coordinating agent submits one frozen plan and waits for the program-owned terminal receipt before interpreting reports.

Provider contracts in `teammate-adapters.ts` cover Codex app-server, DSH ACP, Copilot ACP, and Claude Code CLI. `teammate-launch.ts` binds the selected role, profile, context, write policy, and capability snapshot. A contract fixture is not a verified external host. Until a host passes the separate capability gate, `teamwork batch` fails closed before writing coordination state.

Task-owned batch artifacts live under the active task's `teammates/<batch>/<work>/` tree. They remain evidence for that task and do not become an alternate task status store.

## Configuration

Runtime controls use the new `teamwork` root:

- `teamwork.teammate.max_concurrency` bounds batch slots.
- `teamwork.teammate_guard.idle_timeout` and `max_live_teammates` guard process lifetime.
- `teamwork.teammate_guard.non_batch_reserved` keeps capacity available for explicitly planned single-process operations.
- `.trellis/agents/teammate-profiles.json` holds provider/model defaults and named execution profiles.

The `TRELLIS_TEAMWORK_*` environment variables override the corresponding Teamwork runtime controls. Core Channel storage settings such as `TRELLIS_CHANNEL_ROOT` remain Channel settings.

## Bundled Skill

`trellis-teamwork` routes command syntax, fixed-batch preparation, profile/process details, independent evaluation, forums, and diagnostics to on-demand references. It must describe only the generic teammate role and must not teach manual per-unit scheduling as a substitute for the batch coordinator.
