# Platform Files Overview

Trellis connects the same local architecture to different AI tools. `.trellis/` stores the shared runtime; platform directories store adapter files that define how each AI tool enters Trellis.

When a local AI modifies Trellis, it should distinguish two file categories first:

- **Shared files**: `.trellis/workflow.md`, `.trellis/tasks/`, `.trellis/spec/`, `.trellis/scripts/`.
- **Platform files**: `.claude/`, `.snow/`, `.codex/`, `.cursor/`, `.opencode/`, `.kiro/`, `.gemini/`, `.qoder/`, `.codebuddy/`, `.github/`, `.factory/`, `.pi/`, `.trae/`, `.kilocode/`, `.agent/`, `.devin/`, `.reasonix/`, `.zcode/`, `.kimi-code/`, `.dsh/`, and similar directories.

Platform files do not store business state. They let the corresponding AI tool read Trellis state, call Trellis scripts, and load Trellis skills/agents/hooks.

## Platform File Categories

| Category | Common paths | Purpose |
| --- | --- | --- |
| settings/config | `.claude/settings.json`, `.codex/hooks.json`, `.qoder/settings.json`, `.trae/hooks.json` | Register hooks, plugins, extensions, or platform behavior. |
| hooks/plugins/extensions | `.claude/hooks/`, `.opencode/plugins/`, `.pi/extensions/` | Inject context at session start, user input, agent startup, shell execution, and similar events. |
| 协作角色 | `.trellis/agents/` | Teamwork 只读角色与 Paseo 实施节点；Kiro 另有主会话入口。 |
| skills | `.claude/skills/`, `.agents/skills/`, `.qoder/skills/`, `.zcode/skills/` | Capability descriptions that auto-trigger or can be read on demand. |
| commands/prompts/workflows | `.cursor/commands/`, `.github/prompts/`, `.devin/workflows/`, `.zcode/commands/` | Entry points explicitly invoked by the user. |

## Three Platform Integration Modes

### 1. Hook / Extension Driven

These platforms can trigger scripts or plugins on specific events and actively inject Trellis context into AI.

Common capabilities:

- session-start injection of a `.trellis/` overview.
- workflow-state hints for each user turn.
- Shell commands inheriting session identity.

To change "when the AI knows what," inspect hooks/plugins/extensions and settings first.

### 2. Agent Prelude / Pull-Based

协作上下文由原生工作包或节点合同提供，职责见 `agents.md`。

### 3. Main-Session Workflow

没有启动 Hook 的平台通过 workflow、Skills 和命令引导主会话读取文件、运行脚本并推进任务。

To change behavior, inspect platform workflows/skills/commands and `.trellis/workflow.md`.

## Local Modification Order

When the user asks to customize behavior for a platform, the AI should inspect files in this order:

1. Read `.trellis/workflow.md` to confirm the shared flow.
2. Read the target platform's settings/config to see which hooks/agents/skills/commands are registered.
3. Read the target platform's agents/skills/commands/hooks.
4. Modify the local file closest to the user's need.
5. If the change affects the shared flow, synchronize `.trellis/workflow.md` or `.trellis/spec/`.

Do not modify only platform files and forget the shared workflow. Do not modify only `.trellis/workflow.md` and forget that platform entry points may still contain old descriptions.
