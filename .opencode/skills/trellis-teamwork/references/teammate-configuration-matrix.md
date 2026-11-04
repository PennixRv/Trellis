# Teammate 配置矩阵

配置由项目文件持有，运行时读取；下表解释默认选择，不替代实际文件。

| 文件 | 职责 |
| --- | --- |
| `.trellis/agents/teammate-profiles.json`，schema 2 | `default_profile`；每个 profile 的 `role`、`default_configuration` 和 2–3 套命名 `configurations` |
| `.trellis/agents/teammate.md` | 通用角色、只读职责和结果合同 |
| `.trellis/agents/profiles/<profile>.md` | 精确专业角色卡；普通 Markdown，通过 Trellis 注入，不注册宿主原生角色 |
| `.trellis/teamwork.json`，schema 1 | `default_mode` 及三种模式的 `default_members` |
| `.trellis/config.yaml` 的 `teamwork.*` | 并发和进程容量限制 |

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

构造器冻结有效执行值、通用加专业角色指令、上下文、模式配置摘要和能力摘要。后续改配置只影响新计划，已有计划执行时不重新解析角色文件。模型不可用、推理强度未被后端声明或选项不支持时明确失败。

四种 transport 为 Codex app-server、Claude Code stream-json、Copilot ACP 和 DSH ACP。Copilot 原生 CLI 支持非交互调用；这里选择 ACP 是为了统一会话、配置与取消回执。DSH 使用 `dsh --profile acp`，恢复使用其声明的 `session/resume`；Copilot 使用 `session/load`。安装、账号和真实调用结果须单独核验，fixture 通过不证明某个后端已可用。

Codex 使用 `developerInstructions`，Claude 使用独立的 append-system-prompt；ACP v1 只有用户内容块，Trellis 将角色与任务编码为两个明确区分的块，但不宣称具有独立 system 优先级。不会动态改写 `AGENTS.md` 或注册 provider 原生 persona。

源码、Git、递归委派和隐式历史使用限制是角色义务。宿主能力检查只声明实际运行能力：前台等待、受控产物、transport 和容量；不声称完成文件系统只读或记忆隔离。可用工具与宽权限模式不授予 teammate 编写产品代码的职责。
