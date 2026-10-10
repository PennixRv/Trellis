# Change Local Skills, Commands, Prompts, And Workflows

When the user wants to change AI entry points, auto-trigger rules, or explicit command behavior, edit skills, commands, prompts, or workflows in local platform directories.

Before editing, classify the skill you are about to touch:

- **Bundled multi-file skill** — `trellis-meta`, `trellis-spec-bootstrap`, `trellis-session-insight`, `trellis-channel`, `trellis-research-record`. Source lives under `packages/cli/src/templates/common/bundled-skills/<name>/`; `getBundledSkillTemplates()` distributes it to each platform skill root on init/update.
- **Other Trellis-managed entry** — single-file skills such as `trellis-check` and `trellis-before-dev`, command-backed skills such as `trellis-finish-work`, and platform-specific entries. Their sources live under `common/skills/`, `common/commands/` or the relevant platform template directory. Configurators generate them and update tracks their template hashes too.
- **Project-local entry** — content created by the project outside the managed template set, owned by the user and not refreshed by `trellis update`. Its directory or absence from a short bundled-name list does not establish ownership.

The remainder uses "skill" for the local file. Confirm its actual source and generated-file ownership before choosing the edit path.

## Read These Files First

1. `.trellis/workflow.md`
2. Target platform skill/command/prompt/workflow directory
3. Related agent or hook files
4. Whether project rules already exist in `.trellis/spec/`
5. `.trellis/.template-hashes.json` and the relevant template/configurator — a hash entry confirms management; a missing entry alone does not prove project ownership.

## Which Entry Type To Choose

| Goal | Recommendation |
| --- | --- |
| AI should automatically know a capability | Add or modify a skill. |
| User wants to trigger manually with a command | Add or modify a command/prompt/workflow. |
| Team project conventions | Prefer `.trellis/spec/` or a project-local skill — never a bundled skill directory. |
| Tweak a bundled skill (`trellis-meta` et al.) for the user's own project | Create a project-local sibling skill (different name) that overrides intent, or edit `.trellis/spec/`. Edits inside the bundled skill directory survive only until the next `trellis update` and will need a "keep" choice each time. |
| Contribute the change back upstream | Edit its actual bundled, common skill/command or platform template source in the Trellis CLI repo, not the deployed copy. |
| Change Trellis flow semantics | Synchronize `.trellis/workflow.md`. |

## Modify A Skill

A skill is usually:

```text
<skill-name>/
├── SKILL.md
└── references/
```

`SKILL.md` should be short and responsible for triggering/routing. Put long content in `references/` so AI can read it on demand.

The frontmatter description should specify when to use the skill. Example:

```yaml
description: "Use when customizing this project's deployment workflow and release checklist."
```

Do not write vague descriptions such as "helpful project skill"; they can trigger incorrectly.

### Bundled vs. Project-Local

The same directory shape can contain different ownership models:

| Aspect | Trellis-managed entry | Project-local |
| --- | --- | --- |
| Source of truth | Actual bundled, common skill/command or platform template in the Trellis CLI repo | Inside the user project itself |
| Generation | Bundled files use `getBundledSkillTemplates()`; other entries use the platform configurator on init/update | Created by the user (or another skill) |
| Hash tracking | Every file recorded in `.trellis/.template-hashes.json`; conflict prompt on update | Not tracked |
| Editing locally | Allowed but will be marked "modified by user" on next update | Free editing |
| The right way to customize | Add a *new* project-local skill with a *different* name that supplements (or supersedes) the bundled one | Edit the file directly |

If the goal is "make my project's AI behave differently when discussing release notes," the answer is almost always a project-local skill, not surgery on `trellis-meta/`.

## Modify A Command/Prompt/Workflow

Explicit entry points should state:

- How the user triggers it.
- Which `.trellis/` files to read.
- Which scripts to run.
- How to report after completion.

If a command only repeats workflow rules, prefer making it reference/read `.trellis/workflow.md` instead of maintaining a second copy of the flow.

## Common Paths

| Platform | Entry directories |
| --- | --- |
| Claude Code | `.claude/skills/`, `.claude/commands/` |
| Cursor | `.cursor/skills/`, `.cursor/commands/` |
| OpenCode | `.opencode/skills/`, `.opencode/commands/` |
| Codex | `.agents/skills/`, `.codex/skills/` |
| Gemini CLI | `.agents/skills/`, `.gemini/commands/` |
| Kiro | `.kiro/skills/` |
| Qoder | `.qoder/skills/`, `.qoder/commands/` |
| CodeBuddy | `.codebuddy/skills/`, `.codebuddy/commands/` |
| GitHub Copilot | `.github/skills/`, `.github/prompts/` |
| Factory Droid | `.factory/skills/`, `.factory/commands/` |
| Pi Agent | `.agents/skills/` |
| Reasonix | `.reasonix/skills/` (no separate commands dir; slash commands built into the platform) |
| ZCode | `.zcode/skills/`, `.zcode/commands/` |
| Kilo / Antigravity / Devin | workflows + skills |

The bundled multi-file skills are distributed to each supported platform skill root on init/update; other managed entries follow that platform's configurator. Read the actual template set rather than inferring it from a fixed count.

## Add A Project-Local Skill

If the user wants to document team-private customizations, create a project-local skill — never put project-private content into a bundled skill directory, since `trellis update` will overwrite it.

```text
.claude/skills/project-trellis-local/
└── SKILL.md
```

For multi-platform projects, add equivalent versions in each platform skill directory, or use `.agents/skills/` on platforms that support the shared layer (Codex, Gemini CLI).

Pick a name that does **not** collide with the bundled set:

- `trellis-meta`
- `trellis-spec-bootstrap`
- `trellis-session-insight`
- `trellis-channel`
- `trellis-research-record`

Also avoid names of generated single-file or platform entries. A collision becomes managed template content or an update conflict; it is not a durable override. A common convention is to prefix the project name: `acme-trellis-deploy`, `acme-trellis-onboarding`.

## Notes

- Do not mix every platform's syntax into one file.
- Do not change only one platform entry point while claiming all platforms are supported.
- Do not hide long-term engineering conventions inside a command; write them to `.trellis/spec/`.
- Do not hand-edit files inside `trellis-meta/`, `trellis-spec-bootstrap/`, `trellis-session-insight/`, or `trellis-channel/` under any `.{platform}/skills/` directory expecting the change to persist — they are bundled and refreshed by `trellis update`. Either contribute upstream or add a project-local skill that complements them.
- After `trellis update` reports a "modified by you" conflict on a bundled skill file, choose **keep** only if you accept maintaining the divergence by hand; otherwise accept the overwrite and re-apply the intent as a project-local skill.
