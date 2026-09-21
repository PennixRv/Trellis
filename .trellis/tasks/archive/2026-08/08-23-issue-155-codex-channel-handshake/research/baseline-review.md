# Baseline Review: Codex Channel Handshake

## Conclusion

The candidate adapter change has the correct high-level direction: replace a
fixed startup delay with a response-gated sequence of `initialize`,
`initialized`, and `thread/start`. It is not accepted yet. The component must
first complete GitNexus impact analysis and run its required package checks.

## Confirmed Evidence

- Baseline commit: `fd4bb6480cffa32c7c3a05042da0ee8b351a5e8c`.
- The baseline handshake in
  `packages/cli/src/commands/channel/adapters/index.ts` wrote `initialize`,
  waited for 150 ms, then wrote `thread/start`; it did not emit `initialized`
  or wait for an initialization response.
- The official [Codex App Server documentation](https://learn.chatgpt.com/docs/app-server)
  requires `initialize`, followed by the id-less `initialized` notification,
  before another request. It states that requests before initialization receive
  `Not initialized`.
- `packages/cli/src/commands/channel/supervisor.ts` starts the stdout pump
  before `adapter.handshake`, then turns a thrown handshake error into an
  `error` event and crash shutdown. The response parser can therefore satisfy a
  registered handshake waiter before the thread is marked ready.
- Candidate changes add a bounded request-id waiter in `codex.ts`, wait for an
  object initialization response, write `initialized`, then wait for the
  `thread/start` response. They preserve the existing thread-id projection in
  `parseCodexLine`.

## Candidate Coverage Gaps

- Current tests cover response order, initialization JSON-RPC error,
  initialization child exit, `thread/start` JSON-RPC error, malformed
  `thread/start` result, and timeouts.
- They do not yet explicitly cover an invalid non-object initialization result,
  child `error` during either handshake request, or that `pending` and
  `responseWaiters` are empty after each terminal path.
- Those gaps are candidate work only. Any source or test edit requires the
  GitNexus impact gate first.

## Environment Gates

- The committed GitNexus runner `.gitnexus/run.cjs` was absent. The first
  `npx --yes gitnexus analyze` exited because its npx cache lacked the required
  `@ladybugdb/core` native binary. Running the tool-provided
  `@ladybugdb/core/install.js` repair and then
  `npx --yes gitnexus analyze --index-only --workers 1 --verbose` completed a
  local-only index without injecting project guidance.
- This Codex host exposes no GitNexus MCP tool, but the installed GitNexus CLI
  provides direct `impact` and `detect-changes` commands. The component task
  uses those commands; the completed results are recorded in `validation.md`.
- `pnpm` and `corepack` are not on PATH, but dependencies are present and the
  lockfile declares `pnpm@10.32.1`. That exact version is runnable through
  `npx`; targeted tests, lint, typecheck, build, and the full CLI suite have
  completed successfully.

## Scope Boundary

The root audit's worker-capability finding remains unproven. A protocol-correct
handshake is necessary to run the later sentinel, but it does not establish
that the handshake caused a missing shell, file, context, or report-write
capability.
