# Validation Record: Codex Channel Handshake

## Result

All local component quality checks pass. The candidate diff is limited to the
Codex adapter handshake, its regression tests, and the channel code-spec.
Publishing and fresh-host runtime acceptance are not part of this local record.

## Protocol Evidence

The [official Codex App Server documentation](https://learn.chatgpt.com/docs/app-server)
states that a connection sends one `initialize` request, follows it with the
id-less `initialized` notification, and only then invokes other methods. It
also states that requests before initialization receive `Not initialized`.

## GitNexus

- A missing npx-cache `@ladybugdb/core` native binary initially prevented
  indexing. The tool-provided installer repaired the cache without changing
  project source, then `npx --yes gitnexus analyze --index-only --workers 1
  --verbose` indexed 9,608 nodes, 16,935 edges, and 300 flows.
- Upstream `impact` results before test edits were LOW: `codexAdapter` had no
  static upstream callers; `awaitCodexResponse`,
  `encodeCodexRequestWithResponse`, `waitForCodexResponse`, and
  `cancelCodexResponse` only flow into the adapter handshake; `handleResponse`
  reaches the parser, the adapter test/trace paths, and one channel-command
  flow.
- `detect-changes --scope compare --base-ref main --limit 200` reported four
  product files, 26 changed symbols, zero affected processes, and LOW risk.

## Commands And Results

| Command | Result |
| --- | --- |
| `npx --yes pnpm@10.32.1 --filter @mindfoldhq/trellis exec vitest run test/commands/channel-codex-adapter.test.ts` | pass: 1 file, 22 tests |
| `npx --yes pnpm@10.32.1 --filter @mindfoldhq/trellis lint` | pass |
| `npx --yes pnpm@10.32.1 --filter @mindfoldhq/trellis typecheck` | pass |
| `npx --yes pnpm@10.32.1 --filter @mindfoldhq/trellis build` | pass |
| `npx --yes pnpm@10.32.1 --filter @mindfoldhq/trellis test` | pass: 74 files, 1,671 tests |
| `git diff --check` | pass |

## Regression Coverage Added

- Exact successful response-driven ordering and id-less `initialized`.
- Initialization JSON-RPC error, non-object result, timeout, child exit, and
  child error, all with no premature `thread/start`.
- `thread/start` JSON-RPC error, malformed result, timeout, and child error,
  all with no ready state.
- Every checked success or terminal path leaves both `pending` and
  `responseWaiters` empty.

## Commit And Remaining Gate

The verified component change was committed as
`109c9626c0c8ec7fc081cb7e53dca319c11896dd`
(`fix(channel): gate Codex thread startup on initialization`). The root audit
must now independently determine the CI-only release route and run its
fresh-host worker capability sentinel. These local checks do not close the root
worker-capability finding.
