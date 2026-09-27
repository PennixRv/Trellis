# Trellis subnode Hindsight isolation design

## Existing execution path

The `subnode` agent definition loads sibling `subnode.env`. `agent-loader.ts` resolves it within the trusted `.trellis/agents` root; `spawn.ts` parses plain `KEY=VALUE` entries; supervisor constructs the child environment as `{ ...process.env, ...config.env, TRELLIS_HOOKS: "0", ... }`. Thus a role value overrides only the spawned Codex child and does not change the main coordinator environment.

The pinned `@vectorize-io/hindsight-coding-agents` 0.6.1 integration reads `HINDSIGHT_DISABLED` as its `disabled` config field. Its hooks check this before recall/write; its MCP server returns an empty tool list when disabled. The MCP installer sets only `HINDSIGHT_MCP_HARNESS` in its server entry, so the child process's disabled value remains inherited. The Hindsight server is v0.10.1. Validate this against the pinned integration in the parent suite.

## Minimal template change

Replace the three OpenViking variables in `packages/cli/src/templates/trellis/agents/subnode.env` with one line:

```dotenv
HINDSIGHT_DISABLED=1
```

Make the same edit to the source project's generated asset only if it is the tracked fork asset; preserve existing file ownership/managed-update semantics. Do not add API keys, project paths, duplicated hook toggles, or Hindsight source code. Keep coordinator access intact.

Update `codex-subnode-channel` workflow/workers guidance only where it currently explains OpenViking behavior. Explain that child Hindsight hooks are disabled, the child MCP server exposes no Hindsight tools, and the main coordinator can selectively pass reviewed context. Do not otherwise redesign the subnode prompt contract.

## Validation boundary

Template/unit tests assert exact environment contents and generated-source parity. Spawn/supervisor tests assert the child receives the disabled value and the parent `process.env` remains unchanged. Parent integration tests run the pinned Hindsight v0.10.1 config/hook/MCP behavior under synthetic isolated environments; no production transcript or project bank is involved. Run all tests only after all owner implementations are finished.
