# Trellis AgentMemory subnode与迁移合同

目标pennix/v0.7-beta；根只消费生成资产。父任务design/implement/research13为cross-owner合同；本任务不实现AgentMemory服务或Pennix policy。

Codex agent=subnode合并process/role/config全部env后删除AGENTMEMORY_*，再设AGENTMEMORY_SDK_CHILD=1。argv同时加-c 'plugins."agentmemory@agentmemory".enabled=false'和-c mcp_servers.agentmemory.enabled=false：whole-plugin关闭官方hooks/Skills/插件MCP，native override关闭Pennix注册的独立MCP。main和其他plugin不改，不关闭features.hooks，不用thread/start.config。marker是脚本误执行的防御，不能单独保证MCP工具零暴露；不声称OS级网络隔离。

目标源入口packages/cli/src/commands/channel/adapters/codex.ts与adapters/index.ts及真实supervisor/env合并调用点；先GitNexus context/impact核实caller，再最小修改共用入口。Trellis AGENTS要求的graph UNKNOWN不能当零影响，需补证据；metadata/doc编辑不修改函数。相关测试现有channel-context-trust.test.ts、templates/trellis.test.ts及现有migration suites扩展，不建第二套spawn框架。

模板agents/subnode.env及env_file仅为旧Hindsight，应从新workflow/platform资产移除。native migration只删已知生成内容/hash，modified/hashless/路径冲突保留并可见报告；更新生成账本，不留无条件new/residue。核对所有workflow/Skill/config/spec中的活动Hindsight入口，通用内容在fork修复，根不copy模板。主会话注入允许D11共享候选，但task/Git/handoff仍权威；不新建Trellis memory bank/协议。

测试覆盖env合并后覆盖attempt、无secret、argv双入口、6hook marker零请求、plugin Skill/MCP工具缺失、主会话对照；pristine/modified/hashless/重复update/消费者new冲突。真实AgentMemory plugin/native MCP安装后验收，配置解析成功不是网络零请求证明。

当前CLI/core beta.20；统一验收后原生release:beta，当前下一号beta.21。CLI/core版本同步、npm beta dist-tag/tag/remote确认后才更新consumer。根项目与Trellis自身均原生trellis update，不手工本地模板修补；上游协议或版本漂移触发replan，不再用旧MCP-only结论。
