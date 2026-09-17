# Root Cause Evidence

- The observed Channel create event contained no `ownerSessionId`, while its
  Codex workers later wrote durable `session_bound` events.
- CCH calls `trellis channel list --owner-session <main-id>` and only renders
  Channels whose immutable create owner exactly matches its current main Codex
  session. The ownerless Channel was therefore intentionally excluded.
- Trellis CLI resolves the owner only from explicit `--owner-session`,
  `CODEX_THREAD_ID`, or legacy `CODEX_SESSION_ID`. The FastCtx execution
  environment exposed none of them, so creation silently stored no owner.
- The CCH renderer, tmux configuration, and worker/session event projections
  were functioning. Changing CCH would weaken session isolation rather than
  fix the missing ownership contract.

Evidence locations: `packages/cli/src/commands/channel/create.ts`,
`packages/cli/src/commands/channel/spawn.ts`, and the installed CCH
`src/tmux-status/trellis-channel.ts` implementation.
