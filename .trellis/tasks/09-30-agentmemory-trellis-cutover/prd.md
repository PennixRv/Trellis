# Trellis AgentMemory subnode hard-off与消费者迁移

## Goal

父09-30-agentmemory-hard-cutover的Trellis pennix/v0.7-beta实现包；当前planning到开工边界，不改源码/发包，不新branch。

## Requirements

- 仅fork CLI/channel adapter/supervisor、模板/native migration、workflow/spec/测试，根只消费。
- Codex agent=subnode全部env合并后剥离AGENTMEMORY_*再设SDK_CHILD=1；argv同时禁plugins."agentmemory@agentmemory".enabled与mcp_servers.agentmemory.enabled，整体plugin hooks/Skills/MCP和独立native MCP均关闭。
- 不关全局hook/其他plugin，不改主会话，不用thread/start.config，不称OS网络隔离；marker是补充防御。
- 新模板无Hindsight专属subnode.env/env_file；原生migration仅精确已知生成内容/hash删除，modified/hashless保留可见冲突，更新账本，不让根持有通用修补。
- Trellis/Git/spec/core权威，允许D11共享候选但不以memory改task/授权/receipt；不新增memory库或复刻Pennix policy。
- AGENTS/spec前置阅读、GitNexus impact/detect_changes按真实源码路径；所有owner实现齐全后统一typecheck/lint/test/build与在线hard-off验收。
- 验收后原生beta发布、remote/npm version/tag核验，根与Trellis自身native update，不手工cache/模板覆盖。

## Acceptance

- [ ] 最终env无AgentMemory secret/profile，仅SDK_CHILD=1；argv两个精确override均生效，真实subnode无AgentMemory hooks/Skills/tools/server，6脚本零请求。
- [ ] 主会话及非AgentMemory插件/Codex provider/task-channel正常，未认证API由NAS拒绝，不虚称网络隔离。
- [ ] pristine旧模板删除、modified/hashless冲突保留、repeat update无漂移；init/workflow生成无活动Hindsight。
- [ ] pnpm typecheck/lint/test/build/release:check/release:plan、相关现有Python/runtime入口与graph变更审查通过。
- [ ] beta提交推送、CLI/core同步新beta及registry/tag正确；root/Trellis消费者原生升级与发布环境smoke通过，无根侧通用源码，新资产不会恢复旧入口；收据/原生归档完成。
