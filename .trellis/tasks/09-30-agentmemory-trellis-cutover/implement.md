# Trellis实施与beta发布计划

当前planning；父seal完成且用户启动实施后原生start，主会话inline，固定pennix/v0.7-beta，不新branch。旧Hindsight任务已归档，不重复归档。

1. 检查target branch/remote及既有变更，读trellis-before-dev/CLI backend、unit-test、migration/filesystem-safety specs；按AGENTS执行GitNexus context/impact定位共享spawn/env/argv路径，未知影响补证据。
2. 在实际共有supervisor/env入口与Codex adapter实现合并后AGENTMEMORY_*剥离/child marker、whole-plugin与native MCP两个process override，不加全局hooks开关或重复launcher。
3. 删除Hindsight专属template subnode.env/env_file并做native migration，更新活动workflow/Skills/spec引用、生成hash账本，用户修改冲突保留可见；不把根当通用源码owner。
4. 一次补齐env/argv/模板升级回归和真实plugin hard-off验收入口，所有owner实现完成才统一测试。
5. 统一运行pnpm typecheck、pnpm lint、pnpm test、pnpm build、pnpm release:check、pnpm release:plan；按现有spec执行相关Python/runtime检查。真实主/子对照、6hooks零请求与MCP/Skill缺失，pristine/modified/hashless/repeat消费者升级必须通过。git diff --check；提交前GitNexus detect_changes且无未解析风险。
6. 与父S3协调，提交推送目标branch，使用pnpm release:beta发布下一可用beta（现状beta.21），记录CLI/core实际version、tag、npm beta dist-tag、remoteSHA。遵守原生release工具生成/提交规则，不重复手工bump/tag。
7. Pennix更新catalog并重装CLI后，根项目及Trellis自身按native workflow update升级。对通用new差异在fork改正/发beta，modified用户资产只报冲突，不手工覆盖根。发布环境再次smoke通过后返回父退役门槛；归档本owner任务。

失败停止发布/consumer更新；保持Trellis/core-only和其他插件正常。材料设计冲突原生replan；已选设计的普通修复不制造二次批准闸门。本回合不实施。
