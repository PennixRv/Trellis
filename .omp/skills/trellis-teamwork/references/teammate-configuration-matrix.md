# Teammate 配置矩阵

配置由项目文件持有，运行时读取；下表解释默认选择，不替代实际文件。

| 文件 | 职责 |
| --- | --- |
| `.trellis/agents/teammate-profiles.json`，schema 2 | `default_profile`；每个 profile 的 `role`、`default_configuration` 和 2–3 套命名 `configurations` |
| `.trellis/agents/teammate.md` | 通用角色、只读职责和结果合同 |
| `.trellis/agents/profiles/<profile>.md` | 精确专业角色卡；普通 Markdown，通过 Trellis 注入，不注册宿主原生角色 |
| `.trellis/teamwork.json`，schema 2 | `default_mode`；各模式的 `default_members`、`max_concurrency`；`resources` 中的共享进程预算与非 batch 预留 |
| `.trellis/config.yaml` 的 `teamwork.teammate_guard.idle_timeout` | 空闲清理；旧容量键仅在未迁移到 schema 2 时兼容读取 |

默认成员数为 general 1、advisor 3、committee 3；默认并发上限分别为 8、3、3，共享存活进程预算为 8，非 batch 预留为 0。成员数用于构造计划，不要求同时运行；有效并发还受显式请求、共享预算和宿主能力约束。schema 2 不再叠加旧 YAML 容量上限，兼容读取和环境覆盖均在 `capacityPolicy.diagnostics` 中说明。`capacityPolicy` 是解析结果，不是另一套配置。

每套执行配置包含 `provider`、`model`，可选 `reasoning_effort` 和适配器支持的 `options`。上下文长度沿用 provider 默认，不配置 token 或预算机制。`teammate` 是内部执行者类型，公开计划不填写 `role_id`；`lens` 只表示成员的“本次关注点”。

| Profile | 工作职责 | 默认配置 | 第二候选 | 第三候选 |
| --- | --- | --- | --- | --- |
| `architecture` | 架构、接口、依赖与取舍 | codex / gpt-6.1-sol / xhigh | copilot / gpt-6.1-sol / xhigh | copilot / claude-opus-5.5 / xhigh |
| `review` | 基于当前差异的正确性审查 | codex / gpt-6.1-sol / high | copilot / gpt-6.1-sol / high | copilot / claude-opus-5.5 / high |
| `research` | 外部资料、先例与时效核验 | codex / gpt-6.1-sol / high | copilot / gpt-6.1-sol / high | copilot / claude-sonnet-5.5 / high |
| `verification` | 独立验收、验证和证据核对 | codex / gpt-6.1-sol / high | copilot / gpt-6.1-sol / high | copilot / claude-sonnet-5.5 / high |
| `exploration` | 围绕主题探索本地源码、调用和边界 | codex / gpt-6.1-sol / high | copilot / gpt-6.1-sol / high | copilot / claude-sonnet-5.5 / high |
| `diagnosis` | 针对已知故障验证根因假设 | codex / gpt-6.1-sol / high | copilot / gpt-6.1-sol / high | copilot / claude-opus-5.5 / high |

候选名为 `codex-sol`、`copilot-sol`，以及 `copilot-opus` 或 `copilot-sonnet`。默认 profile 为 `exploration`。先查实际设置：

```bash
trellis teamwork config --profile architecture --configuration copilot-opus --mode committee
```

成员显式覆盖执行值只作用于该成员，不改项目默认。多成员应考虑同 provider 不同模型、跨 provider 同模型或不同专业的收益，填写 `selection_reason`；不强制异构、不自动轮换、不静默 fallback。`architecture + committee` 可以让 2–3 位架构成员分别使用不同配置。

构造器冻结有效执行值、通用加专业角色指令、模式结果合同、上下文、模式配置摘要和能力摘要。能力的 `evidence: adapter-contract` 说明它来自静态适配器合同，不是已安装后端的成功探测。后续改配置只影响新计划，已有计划执行时不重新解析角色文件；新计划的参考文件在派发前后核对冻结摘要。模型不可用、推理强度未被后端声明或选项不支持时明确失败，并保留实际配置协商阶段及后端声明信息。

四种 transport 为 Codex app-server、Claude Code stream-json、Copilot ACP 和 DSH ACP。Copilot 原生 CLI 支持非交互调用；这里选择 ACP 是为了统一会话、配置与取消回执。DSH 使用 `dsh --profile acp`，恢复使用其声明的 `session/resume`；Copilot 使用 `session/load`。安装、账号和真实调用结果须单独核验，fixture 通过不证明某个后端已可用。

Codex 使用 `developerInstructions`，Claude 使用独立的 append-system-prompt；ACP v1 只有用户内容块，Trellis 将角色与任务放在两个明确区分的纯文本块，但不宣称具有独立 system 优先级。完整角色在同一会话成功完成一轮后不重复发送，恢复或首次失败后重新建立。参考资料通过任务数据通道发送。不会动态改写 `AGENTS.md` 或注册 provider 原生 persona。

源码、Git、递归委派和隐式历史使用限制是角色义务。宿主能力检查只声明实际运行能力：前台等待、受控产物、transport 和容量；不声称完成文件系统只读或记忆隔离。可用工具与宽权限模式不授予 teammate 编写产品代码的职责。

工具权限自动允许，不设置默认沙箱或工具/路径准入限制。Codex 默认 `danger-full-access`、`approvalPolicy: never`；ACP 自动选择后端提供的允许选项。宿主仍可能附加 AGENTS、Skills 和环境记忆，角色摘要不代表整个有效上下文摘要。
