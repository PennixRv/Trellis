# Design: Require an owner before Codex worker spawn

## Boundary

The immutable owner is channel metadata written by `createChannel`. CCH reads
that metadata as an exact main-session filter before it collects worker session
IDs and cost. A missing owner therefore makes a real worker unobservable to its
own main Codex session.

```
create --owner-session / CODEX_THREAD_ID
  -> create.ownerSessionId
  -> spawn resolves provider
  -> Codex-only owner preflight
  -> supervisor + worker
  -> CCH exact owner filter
```

## Change

Add one Codex-only preflight in the shared `channelSpawn` path after provider
resolution and before the worker guard, locks, configuration, reservation, or
process fork. It reads the first durable event and rejects when it is not a
create event with a non-blank `ownerSessionId`.

The error tells the caller to create the Channel with `--owner-session <id>` or
run from a Codex shell that exposes `CODEX_THREAD_ID`. It bubbles through the
existing command handler, which prints the user-facing error and returns exit
code 1.

`channel run` gains the same `--owner-session` option and passes it to its
internal `createChannel` call. This is the only caller-specific forwarding
needed because direct `channel create` already accepts the option and every
worker launch passes through `channelSpawn`.

## Compatibility and non-goals

- Ownerless Channels remain valid for Claude workers, messages, forums, and
  inspection; only a resolved `codex` provider is rejected.
- No event schema or core SDK change is needed: `ownerSessionId` already exists
  in the create-event contract.
- `TRELLIS_CONTEXT_ID` is deliberately not an owner source. It is a generic
  platform task-context key, while CCH requires the exact Codex main-session
  key.
- The CCH filter remains exact. Broadening it would merge workers from other
  panes or sessions.
- A host bridge that propagates `CODEX_THREAD_ID` into FastCtx is outside this
  Trellis CLI change.

## Rollout and rollback

The release is a stable patch from `main`. A caller without host session
propagation can immediately supply the existing explicit `--owner-session`
escape hatch. If the new validation proves incompatible, reverting the single
preflight and the `channel run` option restores the prior behavior without a
data migration.
