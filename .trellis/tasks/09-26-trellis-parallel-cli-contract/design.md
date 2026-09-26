# CLI contract design

## Scope

This owner task changes only Trellis CLI/template assets on `pennix/v0.7-beta`.
The shared checkout is written serially. Core event type changes are a later
owner handoff after the CLI snapshot is complete. Marketplace workflow and
root coordination remain outside this task.

## F11

- `templates/trellis/agents/subnode-profiles.json` is a managed generic asset.
- `profiles.ts` (or the smallest existing module) loads only an explicitly
  requested profile, verifies a regular in-tree file and bounded JSON, and
  returns resolved model/effort plus source and SHA-256 digest.
- `channel spawn` validates profile/provider/effort/reason before guard locks
  or reservations. `--reasoning-effort-reason` is required for effective
  `xhigh`. Explicit model and effort overrides are one-spawn values.
- The resolved metadata travels through spawn → supervisor → Codex adapter and
  is included in the durable `spawned` event. The adapter only proves request
  construction, not provider adoption.

## F12 (blocked until G1)

Reuse the existing artifact helper's task/path/security validators. Add only
`queue init`, `queue validate`, `queue claim`, and `queue abandon`; use
exclusive creation and no running-state mirror. A claim without a durable
spawn/terminal fact fails closed and is never retried under the same ID.

## Non-goals

No new scheduler, queue service, provider capability probe, tool allowlist,
native hybrid dispatch, telemetry, or automatic retry.
