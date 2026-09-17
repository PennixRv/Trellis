## Bug Analysis: Ownerless Codex Channel worker invisibility

### 1. Root Cause Category

- **Category**: E — Implicit Assumption.
- **Specific Cause**: `createChannel` treated a missing Codex session
  environment value as valid anonymous metadata, while CCH correctly required
  an exact immutable owner to associate workers with the current main session.
  `channelSpawn` did not validate that cross-component precondition.

### 2. Why Fixes Failed

1. No implementation fix preceded this task. The initial investigation focused
   on CCH visibility, but event and environment evidence showed that loosening
   CCH filtering would merge unrelated sessions instead of restoring ownership.

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Runtime | Reject ownerless Codex worker spawn before side effects. | Done |
| P0 | Test coverage | Cover direct spawn, non-Codex compatibility, and one-shot owner forwarding. | Done |
| P1 | Documentation | Record the immutable owner, env precedence, and error matrix in the Channel code spec. | Done |
| P1 | Host integration | Propagate the actual `CODEX_THREAD_ID` into FastCtx command environments. | Deferred outside Trellis |

### 4. Systematic Expansion

- **Similar Issues**: Any future session-scoped consumer must validate its
  required immutable event metadata before a side-effectful worker launch.
- **Design Improvement**: Keep exact owner matching in CCH; validation belongs
  at the Channel spawn boundary where failure is actionable and isolated.
- **Process Improvement**: When a CLI receives identity from a host process,
  test the actual execution boundary rather than assuming shell inheritance.

### 5. Knowledge Capture

- [x] Updated `.trellis/spec/cli/backend/commands-channel.md` with the
  ownership contract and regression requirements.
- [x] Added focused regressions and a built-CLI smoke check.
- [ ] Track FastCtx/Codex session-environment propagation as a separately
  targeted host-integration task when its owner accepts the scope.
