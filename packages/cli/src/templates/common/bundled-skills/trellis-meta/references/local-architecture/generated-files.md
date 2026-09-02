# Local Files Generated After Init

`trellis init` writes the Trellis runtime into the user project. Later, `trellis update` tries to update Trellis-managed template files, but it uses `.trellis/.template-hashes.json` to determine which files have already been modified by the user.

This page only describes files that are visible and editable inside the user project.

## `.trellis/`

```text
.trellis/
├── workflow.md
├── config.yaml
├── .gitignore
├── .developer
├── .version
├── .template-hashes.json
├── .runtime/
├── scripts/
├── spec/
├── tasks/
└── workspace/
```

| Path | Usually editable? | Notes |
| --- | --- | --- |
| `.trellis/workflow.md` | Yes | Local workflow documentation and AI routing rules. |
| `.trellis/config.yaml` | Yes | Project configuration, hooks, packages, journal line limits, and related settings. |
| `.trellis/.gitignore` | No | Generated ignore rules for local Trellis state. Track it, but do not normally edit it. |
| `.trellis/spec/` | Yes | Project specs, intended to be updated regularly by users and AI. |
| `.trellis/tasks/` | Yes | Task material and research artifacts, maintained by the task workflow. |
| `.trellis/workspace/` | Yes | Session records, usually written by `add_session.py`. |
| `.trellis/scripts/` | Carefully | Local runtime. It can be customized, but only after understanding the call chain. |
| `.trellis/.runtime/` | No | Runtime state, usually written automatically by hooks/scripts. |
| `.trellis/.developer` | Carefully | Current developer identity. |
| `.trellis/.version` | No | Trellis version record used by update/migration logic. |
| `.trellis/.template-hashes.json` | No | Template hash record. Do not hand-write business rules here. |

## Git Tracking

`trellis init` and `trellis update` are the single project-asset generation
path. Do not add a second project initializer for Trellis files or platform
integration files: use those commands to create or refresh the generated
assets, then review and commit the resulting project changes normally.

For a Git-tracked project, commit the durable project contract:

- `.trellis/workflow.md`, `config.yaml`, `scripts/`, `spec/`, `tasks/`, and
  `workspace/`;
- `.trellis/.version` and `.trellis/.template-hashes.json`. They are generated
  metadata, not hand-edited configuration; keeping them lets another clone
  distinguish Trellis-owned templates from local changes safely;
- the Trellis-managed files in selected platform directories, plus the
  root-level `AGENTS.md` managed block when Trellis created it.

Do not commit local or ephemeral state. The generated `.trellis/.gitignore`
already excludes `.developer`, `.current-task`, `.runtime/`, `.ralph-state.json`,
agent runtime files, atomic-update files, backups, and Python caches. Platform
session history, caches, logs, and credentials are platform-owned rather than
Trellis templates; apply the platform's own ignore rules or the repository's
security policy to them. If workspace journals contain data that the project
policy forbids in Git, add a project-specific ignore rule rather than changing
the shared Trellis template for every project.

Generated does not mean disposable: `workflow.md`, specs, tasks, journals, and
the template-hash receipt are ordinary project artifacts. Conversely, Trellis
does not infer or broadly ignore all platform directories because doing so
would hide user-owned files that it must preserve.

## Platform Directories

Different platforms generate different directories. Common categories:

| Category | Example paths | Purpose |
| --- | --- | --- |
| hooks | `.claude/hooks/`, `.codex/hooks/`, `.cursor/hooks/` | Inject session context, workflow-state, and sub-agent context. |
| settings | `.claude/settings.json`, `.codex/hooks.json`, `.qoder/settings.json`, `.trae/hooks.json` | Tell the platform when to run hooks or plugins. |
| agents | `.claude/agents/`, `.codex/agents/`, `.kiro/agents/`, `.zcode/agents/` | Define agents such as `trellis-research`, `trellis-implement`, and `trellis-check`. |
| skills | `.claude/skills/`, `.agents/skills/`, `.qoder/skills/`, `.zcode/skills/` | Skills that auto-trigger or can be read by AI. |
| commands/prompts/workflows | `.cursor/commands/`, `.github/prompts/`, `.devin/workflows/`, `.zcode/commands/` | Explicit user-invoked command or workflow entry points. |

When modifying a platform directory, also confirm whether `.trellis/workflow.md` still describes the same flow.

## Meaning Of Template Hashes

`.trellis/.template-hashes.json` records the content hash from the last time Trellis wrote a template file. `trellis update` uses it to distinguish three cases:

| Case | Update behavior |
| --- | --- |
| File was not modified by the user | It can be updated automatically. |
| File was modified by the user | Prompt the user to overwrite, keep, or generate `.new`. |
| File is no longer a current template | It may be deleted, renamed, or preserved according to migration rules. |

When an AI customizes local Trellis files, it does not need to maintain hashes manually. It is normal for Trellis update to recognize the result as "modified by the user."

## Local Customization Boundaries

Editable by default:

- `.trellis/workflow.md`
- `.trellis/config.yaml`
- `.trellis/spec/**`
- `.trellis/scripts/**`
- Platform hooks, settings, agents, skills, commands, prompts, and workflows

Do not edit by default:

- Global npm install directory
- `node_modules/@pennixrv/trellis`
- Trellis GitHub repository source code
- Concrete state files under `.trellis/.runtime/**`
- Hash contents inside `.trellis/.template-hashes.json`

Switch to the Trellis CLI source-code perspective only when the user explicitly wants to contribute upstream.
