# Platform File Map

This page lists common Trellis file locations in a user project by platform. Whether a platform directory exists in an actual project depends on which `trellis init --<platform>` commands the user ran.

## Matrix

| Platform | CLI flag | Main directory | Skill directory | Hooks/extensions |
| --- | --- | --- | --- | --- |
| Claude Code | `--claude` | `.claude/` | `.claude/skills/` | `.claude/hooks/` + `.claude/settings.json` |
| Cursor | `--cursor` | `.cursor/` | `.cursor/skills/` | `.cursor/hooks.json` + `.cursor/hooks/` |
| OpenCode | `--opencode` | `.opencode/` | `.opencode/skills/` | `.opencode/plugins/` |
| Codex | `--codex` | `.codex/` | `.agents/skills/` | `.codex/hooks/` + `.codex/hooks.json` |
| Kilo | `--kilo` | `.kilocode/` | `.kilocode/skills/` | `.kilocode/workflows/` |
| Kiro | `--kiro` | `.kiro/` | `.kiro/skills/` | `.kiro/hooks/` |
| Gemini CLI | `--gemini` | `.gemini/` | `.agents/skills/` | `.gemini/settings.json` + `.gemini/hooks/` |
| Antigravity | `--antigravity` | `.agent/` | `.agent/skills/` | `.agent/workflows/` |
| Devin | `--devin` | `.devin/` | `.devin/skills/` | `.devin/workflows/` |
| Qoder | `--qoder` | `.qoder/` | `.qoder/skills/` | `.qoder/hooks/` + `.qoder/settings.json` |
| CodeBuddy | `--codebuddy` | `.codebuddy/` | `.codebuddy/skills/` | `.codebuddy/hooks/` + `.codebuddy/settings.json` |
| GitHub Copilot | `--copilot` | `.github/` | `.github/skills/` | `.github/copilot/hooks/` + prompts |
| Factory Droid | `--droid` | `.factory/` | `.factory/skills/` | `.factory/hooks/` + settings |
| Pi Agent | `--pi` | `.pi/` | `.agents/skills/` | `.pi/extensions/trellis/` (native `trellis_subagent` tool) + `.pi/settings.json` |
| Trae IDE | `--trae` | `.trae/` | `.trae/skills/` | `.trae/hooks/` + `.trae/hooks.json` |
| Reasonix | `--reasonix` | `.reasonix/` | `.reasonix/skills/` | None |
| ZCode | `--zcode` | `.zcode/` | `.zcode/skills/` | 主会话原生接入；以当前 configurator 输出为准 |
| Grok Build | `--grok` | `.grok/` | `.grok/skills/` | pull-based prelude (no hooks; flat `.grok/commands/trellis-*.md`) |
| Kimi Code | `--kimi` | `.kimi-code/` | `.agents/skills/` (shared) + `.kimi-code/skills/` | None (pull-based prelude; no project hooks/settings) |
| Snow CLI | `--snow` | `.snow/` | `.snow/skills/` | 主会话原生接入；以当前 configurator 输出为准 |
| DeepSeek Harness | `--dsh` | `.dsh/` | `.agents/skills/` (shared) + `.dsh/skills/` | None installed by Trellis (pull-based roles; optional `dsh-trellis` adds event-driven wait, otherwise foreground dispatch) |

## Capability Groups

协作使用 `trellis teamwork` 或 `paseo-based-parallelism`。平台资产仅提供主会话接入，具体角色与节点见 `agents.md`。
