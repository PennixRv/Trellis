# 禁用 Trellis subnode 对 Hindsight 的自动记忆访问

## Goal

为根协调任务 09-27-hindsight-memory-base-migration 更新 Pennix Trellis fork 的 codex-subnode-channel worker contract 和 subnode.env：删除 OpenViking 自动 hook 关闭变量，设置 HINDSIGHT_DISABLED=1 及必要 Hook 防护，使 subnode 不自动采集、不召回且不暴露 Hindsight MCP 工具；保留 main coordinator 唯一记忆入口。目标分支 pennix/v0.7-beta。

## Requirements

- Update the canonical Trellis fork's `codex-subnode-channel` worker contract and bundled `subnode.env` template on `pennix/v0.7-beta`; the root coordinator and downstream projects are consumers, not source owners.
- Remove the three OpenViking-only environment variables. Set only Hindsight v0.10.1's documented `HINDSIGHT_DISABLED=1` for subnodes. The pinned integration resolves this as a hard-off that disables hooks and returns an empty MCP tool list; do not add redundant Hindsight flags or expose credentials to subnodes.
- Preserve the coordinator's Hindsight environment and only scope the hard-off to the spawned subnode environment. Trellis supervisor merges `process.env` then role `subnode.env`, so the child override must not mutate the parent process.
- Keep all other subnode provider/model/sandbox/context/permission behavior unchanged. No Hindsight memory content is automatically injected into subnodes; the coordinator may pass explicitly reviewed, task-minimal context.
- Update template tests, dispatch/environment tests, specs and marketplace workflow docs that still describe OpenViking subnode isolation. Do not update the root consumer's materialized assets until the beta source is released.

## Acceptance Criteria

- [ ] Trellis source and generated template contain `HINDSIGHT_DISABLED=1` and no active `OPENVIKING_*` or `HINDSIGHT_API_TOKEN` entries.
- [ ] Tests prove only spawned subnodes receive the hard-off; main coordinator environment remains unchanged and retains its expected Hindsight capability.
- [ ] Under Hindsight v0.10.1, the same child environment causes Hook paths to no-op and MCP `tools/list` to return no tools; coordinator env returns the normal capability. A mere absence of injection is not sufficient evidence.
- [ ] Existing subnode route, session, model/reasoning, sandbox, context and lifecycle behavior is unchanged outside memory isolation.
- [ ] All active Trellis source docs/templates/tests and beta bundle agree; archived OpenViking-era tasks remain historical.
- [ ] Parent post-implementation unified test phase passes; changes are committed/pushed to existing `pennix/v0.7-beta`, released per Trellis beta release rules, and project assets are updated through the native Trellis workflow.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
