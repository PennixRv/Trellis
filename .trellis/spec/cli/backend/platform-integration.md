---
name: platform-integration
description: How to add support for new AI CLI platforms
paths:
  - packages/cli/src/types/ai-tools.ts
  - packages/cli/src/cli/index.ts
  - packages/cli/src/configurators/**
  - packages/cli/src/templates/**
  - packages/cli/src/commands/init.ts
  - packages/cli/test/types/ai-tools.test.ts
  - packages/cli/test/templates/**
  - packages/cli/test/configurators/platforms.test.ts
  - packages/cli/test/commands/init.integration.test.ts
  - packages/cli/test/regression.test.ts
  - packages/cli/scripts/copy-templates.js
  - README.md
  - README_CN.md
  - .gitignore
---

# Platform Integration Guide

How to add support for a new AI CLI platform. The 21 currently registered are Claude Code, Cursor, OpenCode, Codex, Kilo, Kiro, Gemini CLI, Antigravity, Devin, Qoder, CodeBuddy, Copilot, Factory Droid, Pi, Reasonix, ZCode, Trae, OMP, Grok, Kimi, and Snow — `PLATFORM_IDS` in `configurators/index.ts` is the list that counts.

---

## Architecture

Platform support uses a **centralized registry pattern** (similar to Turborepo's package manager support):

- **Data registry**: `src/types/ai-tools.ts` — `AI_TOOLS` record with all platform metadata
- **Function registry**: `src/configurators/index.ts` — `PLATFORM_FUNCTIONS`, one line per platform. It holds no per-platform logic; the doc-comment at `index.ts:1-11` is the authoritative add-a-platform list
- **Shared configurator utilities**: `src/configurators/shared.ts` — renderers (`resolvePlaceholders()`, `resolvePlaceholdersNeutral()`), resolvers (`resolveCommands()`, `resolveSkills()`, `resolveAllAsSkills()`, `resolveBundledSkills()`), map builders (`collectSkillTemplates()`, `collectBothTemplates()`, `collectSharedHooks()`), and the render/write pair (`renderTemplateMap()`, `writeTemplateMap()`). See `configurator-shared.md`
- **Shared template utilities**: `src/templates/template-utils.ts` — `createTemplateReader()` factory that eliminates boilerplate across platform template modules
- **Shared hooks**: `src/templates/shared-hooks/` — platform-independent Python hook scripts (session-start, inject-workflow-state, inject-shell-session-context) written as-is to platform hook directories according to `SHARED_HOOKS_BY_PLATFORM`. Claude Code `statusLine` is not installed by default.
- **Common templates**: `src/templates/common/` — single source of truth for commands (start, finish-work), single-file workflow skills (before-dev, brainstorm, check, break-loop, update-spec), and multi-file bundled skills (trellis-teamwork, trellis-meta, trellis-session-insight, trellis-spec-bootstrap) with `{{placeholder}}` resolution per platform
- **Shared utilities**: `src/utils/compare-versions.ts` — `compareVersions()` with full prerelease support (used by cli, update, migrations)
- **Derived helpers**: `ALL_MANAGED_DIRS`, `getConfiguredPlatforms()`, etc. — consumed by update, init, hash tracking

All lists (backup dirs, template dirs, platform detection, cleanup whitelist) are **derived from the registry automatically**. No scattered hardcoded lists.

---

## Checklist: Adding a New Platform

When adding a new platform `{platform}`, update the following:

### Step 1: Type Definitions (data registry)

| File                    | Change                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/types/ai-tools.ts` | Add to `AITool` union type                                                                              |
| `src/types/ai-tools.ts` | Add to `CliFlag` union type                                                                             |
| `src/types/ai-tools.ts` | Add to `TemplateDir` union type                                                                         |
| `src/types/ai-tools.ts` | Add entry to `AI_TOOLS` record (name, configDir, cliFlag, defaultChecked, hasPythonHooks, templateDirs) |

**This single entry automatically propagates to**: `BACKUP_DIRS`, `TEMPLATE_DIRS`, `getConfiguredPlatforms()`, `cleanupEmptyDirs()`, `initializeHashes()`, init `TOOLS[]` prompt, Windows detection.

### Step 2: CLI Flag

| File                   | Change                                                |
| ---------------------- | ----------------------------------------------------- |
| `src/cli/index.ts`     | Add `--{platform}` option                             |
| `src/commands/init.ts` | Add `{platform}?: boolean` to `InitOptions` interface |

> Note: Commander.js options and TypeScript interfaces require static declarations — cannot be derived from registry. A compile-time assertion `_AssertCliFlagsInOptions` in `init.ts` will catch missing `InitOptions` fields — you'll get a build error if `CliFlag` has a value not present in `InitOptions`.

### Step 3: Configurator (function registry)

| File                              | Change                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/configurators/{platform}.ts` | Create new configurator exporting **`collect{Platform}Templates(): Map<string, string>`**       |
| `src/configurators/index.ts`      | Add **`{platform}: fromTemplates(collect{Platform}Templates)`** to `PLATFORM_FUNCTIONS`         |

Do **not** write a `configure{Platform}` — `fromTemplates` derives it, so the
platform's file set is described exactly once and `trellis init` and `trellis
update` cannot disagree about it. Copy `configurators/cursor.ts` (30 lines) or
`configurators/antigravity.ts` (15 lines) as the shape.

Only three platforms spell both fields, each for a named residual: claude-code
(the `--with-statusline` flag), codex (an intentionally empty `.codex/skills/`),
zcode (a stderr notice). A residual is work that survives _after_ the shared
writer and cannot be a path→content pair; it never adds a file. If your
platform seems to need one, read `configurator-shared.md` → "Template maps"
first — the parity oracle in `test/configurators/platforms.test.ts` will fail
the build if it is really just an extra write.

### Step 4: Templates

> **Key concept**: Most platforms now derive their content from `src/templates/common/` (commands + skills) via `resolvePlaceholders()` in `configurators/shared.ts`. Platform-specific template directories only contain **agents**, **settings/hooks config**, and platform-specific overrides. The `createTemplateReader()` factory from `src/templates/template-utils.ts` eliminates boilerplate in platform `index.ts` files.

**Standard with shared hooks** (Qoder, CodeBuddy, Droid, Cursor, Gemini, Trae):

| Directory                                                | Contents                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/templates/{platform}/`                              | Root directory                                                          |
| `src/templates/{platform}/index.ts`                      | Uses `createTemplateReader(import.meta.url)` — exports the platform main entry when applicable, settings |
| `src/templates/{platform}/settings.json` or `hooks.json` | Platform settings / hook config (may use `{{PYTHON_CMD}}` placeholder)  |

> Note: These platforms add the platform-independent hook scripts to their template map with `collectSharedHooks(".{platform}/hooks", "{platform}")` from `shared.ts`. Commands and skills come from `src/templates/common/` via `resolveCommands()` / `resolveSkills()` / `resolveAllAsSkills()`, usually through `collectBothTemplates()`. The `createTemplateReader()` factory provides `listMdAgents()`, `getSettings()`, etc. without per-platform boilerplate.
>
> Trae follows this shared-hook template pattern but writes `.trae/hooks.json`, `.trae/commands/trellis-*.md` with command frontmatter, `.trae/skills/`, `.trae/agents/`, and `.trae/hooks/`. Its main session uses `SessionStart` / `UserPromptSubmit` hooks; sub-agent context remains class-2 pull-based because Trae does not expose a Trellis-supported sub-agent prompt mutation surface.

**Claude Code pattern** (full hooks + agents + settings):

| Directory                            | Contents                                                     |
| ------------------------------------ | ------------------------------------------------------------ |
| `src/templates/claude/`              | Root directory                                               |
| `src/templates/claude/index.ts`      | Export functions for agents, hooks, settings                 |
| `src/templates/claude/agents/`       | Agent definitions (`.md` files — implement, check, research) |
| `src/templates/claude/hooks/`        | Claude-specific hook scripts (`.py` files)                   |
| `src/templates/claude/settings.json` | Claude settings (uses `{{PYTHON_CMD}}` placeholder)          |

> Note: Claude Code is the reference platform. It has its own hooks directory (not shared-hooks) because Claude hooks have platform-specific integration points. Commands come from `src/templates/common/commands/`.

**JS plugin pattern** (OpenCode):

| Directory                                    | Contents                     |
| -------------------------------------------- | ---------------------------- |
| `src/templates/{platform}/`                  | Root directory               |
| `src/templates/{platform}/commands/trellis/` | Slash commands (`.md` files) |
| `src/templates/{platform}/plugin/`           | JS plugin files              |
| `src/templates/{platform}/lib/`              | JS library files             |
| `src/templates/{platform}/package.json`      | Plugin dependencies          |

> Note: OpenCode uses JS plugins instead of Python hooks and has no `index.ts` template module — `collectOpenCodeTemplates()` (`opencode.ts:79-95`) walks the template directory instead, then adds commands and skills from `common/`. It is registered through `fromTemplates` like every other platform, so `trellis update` tracks OpenCode files normally. If a new platform uses JS plugins, follow this pattern — and note the walk's `EXCLUDE_PATTERNS` keeps `.js` (real plugin code) while dropping `.js.map` / `.d.ts` build artifacts.

**TypeScript extension pattern** (Pi Agent):

| Directory                                                  | Contents                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/templates/{platform}/`                                | Root directory                                                                            |
| `src/templates/{platform}/index.ts`                        | Uses `createTemplateReader(import.meta.url)` — exports settings and extension source |
| `src/templates/{platform}/extensions/trellis/index.ts.txt` | Project-local extension source written to `.pi/extensions/trellis/index.ts`               |
| `src/templates/{platform}/settings.json`                   | Platform settings that enable extension, skills, and prompts                              |

> Note: Pi Agent uses project-local TypeScript extensions instead of Trellis Python hooks. Keep generated hooks under `.pi/extensions/`, write prompt templates under `.pi/prompts/trellis-*.md`, and do not copy `shared-hooks/*.py` into `.pi/`. Agent Skills write to the shared `.agents/skills/` root (same path Codex and Gemini CLI use) via `resolveSkillsNeutral()`, not a private `.pi/skills/` root — Pi discovers `.agents/skills/` natively, and keeping a separate `.pi/skills/` copy caused Pi to see every skill twice when Codex or Gemini was also installed (#447). `configDir` stays `.pi`; `supportsAgentSkills: true` adds `.agents/skills` to Pi's managed paths, same as Codex/Gemini. A rename-dir migration (`0.6.8.json`) relocates any pre-#447 `.pi/skills/` install into `.agents/skills/` on `trellis update`.
>
> Pi is an explicit `trellis-start` exception: `session_start` is notify-only and cannot mutate model-visible context, so the configurator must keep `.pi/prompts/trellis-start.md` as a manual bootstrap fallback while the extension injects startup/full Trellis context through `before_agent_start.systemPrompt` and persists compact workflow/session context through a hidden custom message returned from `before_agent_start`.
>
> Trellis manages only its own Pi main-session extension. Independently installed community packages remain user-owned and are not a Trellis collaboration route.

**Skills pattern** (Codex, Kiro):

| Directory                                | Contents                                                      |
| ---------------------------------------- | ------------------------------------------------------------- |
| `src/templates/{platform}/`              | Root directory                                                |
| `src/templates/{platform}/index.ts`      | Uses `createTemplateReader(import.meta.url)` — exports the platform main entry when applicable |
| `src/templates/{platform}/settings.json` | Platform settings (optional)                                  |

> Note: Kiro uses `resolveAllAsSkills()` from `shared.ts` to fold every template into a SKILL.md with YAML frontmatter; Codex does the same through `resolveAllAsSkillsNeutral()` because it writes into the shared `.agents/skills/` root. Either way the result goes through `collectSkillTemplates(skillRoot, skills, bundledSkills)` into the platform's template map.
>
> **Qoder is a hybrid** — it has native Custom Commands (`.qoder/commands/{name}.md`) with required YAML frontmatter (`name` + `description`, flat layout per Qoder CLI docs), so session-boundary commands (`finish-work`, `continue`) go there via `resolveCommands()` + `wrapWithCommandFrontmatter()`, while the auto-triggered skills from `common/skills/` stay as `.qoder/skills/` via `resolveSkills()`. Use the `COMMAND_DESCRIPTIONS` registry in `shared.ts` (separate from `SKILL_DESCRIPTIONS`) for the short palette blurbs — command descriptions are one-line imperatives aimed at the user; skill descriptions are long prose aimed at the AI matcher.
>
> **Codex has a two-layer directory model:**
>
> | Layer                     | Install Path      | Template Source                           | Purpose                                                                           |
> | ------------------------- | ----------------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
> | Shared skills             | `.agents/skills/` | Generated from `common/` templates        | Cross-platform skills (agentskills.io standard)                                   |
> | Codex config/agents/hooks | `.codex/`         | `src/templates/codex/{agents,hooks.json}` | Config, custom agents, UserPromptSubmit hook config, and compatibility hook files |
>
> **Key rules:**
>
> - Shared skills in `.agents/skills/` must NOT contain platform-specific references (no `--platform codex`, no `codex exec`)
> - Agent TOML format: `name` + `description` + `developer_instructions` + optional `sandbox_mode` (NOT `[sandbox_read_only]` + `prompt`)
> - Codex hooks require `features.hooks = true` in user config (Codex 0.129+; older versions accept legacy `codex_hooks = true`); 0.129+ also gates per-hook activation behind a one-time `/hooks` TUI review
> - Platform detection uses `.codex/` only — `.agents/skills/` alone does NOT trigger codex detection
> - `configDir` is `".codex"`, with `supportsAgentSkills: true` to auto-include `.agents/skills` in managed paths
>
> **Kimi Code is a hybrid skills platform** — workflow/bundled skills go to the shared `.agents/skills/` root via `resolveSkillsNeutral()` (byte-identical to Codex/Gemini/Pi; Kimi discovers that root natively), while the session-boundary commands (`start` / `continue` / `finish-work`, invoked as `/skill:trellis-<name>`) and the Trellis agent prompts are written as Kimi-private skills under `.kimi-code/skills/<name>/SKILL.md`. Kimi has no project-level hooks/settings file (hooks are user-level `~/.kimi-code/config.toml` only) and no custom sub-agent definitions (built-in coder/explore/plan only), so no hooks, settings, extension, or `agents/` directory is written, and the agent prompts ship as skills with the pull-based prelude on implement/check (class-2).

#### Rule: `.agents/skills/` writes use `resolvePlaceholdersNeutral()`

`.agents/skills/` is a **shared destination**: multiple configurators (Codex, Gemini CLI 0.40+ via the workspace alias, future agentskills.io consumers) all write into the same path. Per-platform `{{CMD_REF:name}}` resolution (`$name` for Codex, `/trellis:name` for Gemini, etc.) makes the same `<skill>/SKILL.md` differ byte-for-byte depending on which configurator ran last → "last-writer-wins" content collisions and `.template-hashes.json` churn.

**Rule**: Anything written under `.agents/skills/` MUST be rendered via `resolvePlaceholdersNeutral()` (in `configurators/shared.ts`), which substitutes `` `name` (Trellis command) `` for `{{CMD_REF:name}}` instead of a platform prefix. All other placeholders (`{{CLI_FLAG}}`, `{{USER_ACTION_LABEL}}`, conditionals, `{{PYTHON_CMD}}`) still resolve from the platform context — those don't appear in the auto-triggered skill templates from `common/skills/`, so the rendered output stays identical across writers.

Per-platform skill directories (`.claude/skills/`, `.cursor/skills/`, `.qoder/skills/`, etc.) keep using `resolvePlaceholders()` — `{{CMD_REF}}` resolves to the platform-correct slash form there, because no other configurator writes those paths.

**Command-as-skill fallback files under `.agents/skills/`** (currently `trellis-start/SKILL.md`, `trellis-continue/SKILL.md`, and `trellis-finish-work/SKILL.md`, written via `resolveAllAsSkillsNeutral()` by Codex) may use per-platform `{{CLI_FLAG}}` / `{{PYTHON_CMD}}` because they are user-invoked fallback entrypoints. They still go through the neutral helper to keep `{{CMD_REF}}` neutralized for consistency with the surrounding shared skills. Platforms with their own private command and skill roots should not write `.agents/skills/`; for example, ZCode writes workflow/bundled skills under `.zcode/skills/` and keeps slash commands under `.zcode/commands/trellis/*.md`.

**Wrong**:

```typescript
// Codex configurator
files.set(".agents/skills/check/SKILL.md", resolvePlaceholders(tmpl, codexCtx));
// Gemini configurator (later)
files.set(
  ".agents/skills/check/SKILL.md",
  resolvePlaceholders(tmpl, geminiCtx),
);
// → byte-different SKILL.md from the same template; whoever runs last wins
```

**Correct**:

```typescript
files.set(
  ".agents/skills/check/SKILL.md",
  resolvePlaceholdersNeutral(tmpl, ctx),
);
// → byte-identical regardless of which configurator wrote it
```

**Kiro JSON agent pattern** (Kiro):

| Directory                     | Contents                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `src/templates/kiro/`         | Root directory                                                                       |
| `src/templates/kiro/index.ts` | Uses `createTemplateReader(import.meta.url)` — exports the platform main entry when applicable via `listJsonAgents()` |
| `src/templates/kiro/agents/`  | Agent definitions (`.json` files)                                                    |

> Note: Kiro is unique in using JSON format for agent definitions (not Markdown). The `createTemplateReader()` factory provides `listJsonAgents()` specifically for this. Skills are generated from `common/` templates via `resolveAllAsSkills()`.

**Workflows pattern** (Kilo):

| Directory               | Contents                                           |
| ----------------------- | -------------------------------------------------- |
| (no template directory) | Kilo generates from `common/` templates at runtime |

> Note: Kilo uses `resolveCommands()` + `resolveSkills()` to generate workflows and skills. No physical template files needed.

**Workflows pattern** (Antigravity):

| Directory               | Contents                                         |
| ----------------------- | ------------------------------------------------ |
| (no template directory) | Antigravity derives from Codex skills at runtime |

> Note: Antigravity has no physical template files. `collectAntigravityTemplates()` (`antigravity.ts:9-15`) is a single `collectBothTemplates()` call against `src/templates/common/` — commands become `.agent/workflows/{name}.md`, skills become `.agent/skills/trellis-{name}/SKILL.md`. **There is no coupling to Codex**; `.codex/skills/` holds only user content and deleting Trellis's Codex skill templates (2026-08-05) changed nothing here. The config dir is `.agent/workflows` with `.agent/skills` as an extra managed path. Workflows are triggered with `/workflow-name` slash commands.

**Copilot pattern** (prompts + hooks):

| Directory                          | Contents                            |
| ---------------------------------- | ----------------------------------- |
| `src/templates/copilot/`           | Root directory                      |
| `src/templates/copilot/index.ts`   | Export functions for prompts, hooks |
| `src/templates/copilot/prompts/`   | Prompt files (`.prompt.md`)         |
| `src/templates/copilot/hooks/`     | Hook scripts (`.py` files)          |
| `src/templates/copilot/hooks.json` | Hooks configuration                 |

> Note: Copilot uses `.prompt.md` format for commands (not plain `.md`). Hooks use `hooks.json` (not `settings.json`).
>
> SessionStart status: Microsoft's [VS Code Agent hooks docs](https://code.visualstudio.com/docs/copilot/customization/hooks) (preview, documented since VS Code 1.110 in Feb 2026) define `SessionStart.hookSpecificOutput.additionalContext` as the field that injects context into the agent's conversation. Trellis's `copilot/hooks/session-start.py` emits this spec-compliant shape. Whether Copilot consumes `additionalContext` depends on the user's installed VS Code and Copilot versions, which is outside Trellis's control — do not re-introduce a hardcoded `systemMessage` claiming Copilot ignores hook output (see GitHub #248). Copilot remains a class-2 (pull-based) platform for sub-agent context delivery until end-to-end consumption is verified.

**Droid pattern** (droids + settings):

| Directory                           | Contents                                                                |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `src/templates/droid/`              | Root directory                                                          |
| `src/templates/droid/index.ts`      | Uses `createTemplateReader(import.meta.url)` — exports droids, settings |
| `src/templates/droid/droids/`       | Droid definitions (`.md` files — implement, check, research)            |
| `src/templates/droid/settings.json` | Droid settings                                                          |

> Note: Droid uses "droids" terminology instead of "agents" but follows the same pattern — `collectDroidTemplates()` sets `.factory/droids/{name}.md` entries directly from `getAllDroids()`.

**Devin pattern** (no template directory):

| Directory               | Contents                                                           |
| ----------------------- | ------------------------------------------------- |
| (no template directory) | Devin generates entirely from `common/` templates |

> Note: `collectDevinTemplates()` (`devin.ts:10-16`) is one `collectBothTemplates()` call — `resolveCommands()` for `.devin/workflows/trellis-{name}.md`, `resolveSkills()` for `.devin/skills/`. Devin gets **no shared hooks at all**: it is not a key in `SHARED_HOOKS_BY_PLATFORM` and has no hook surface. No platform-specific template files needed.

**Required commands/skills**: All platforms must include the following (adapted to each platform's format). Content comes from `src/templates/common/`:

| Type    | Name          | Purpose                                                    | Required |
| ------- | ------------- | ---------------------------------------------------------- | -------- |
| Command | `start`       | Session initialization                                     | Yes      |
| Command | `finish-work` | Pre-commit checklist                                       | Yes      |
| Skill   | `before-dev`  | Read development guidelines (auto-discovers package specs) | Yes      |
| Skill   | `brainstorm`  | Requirements discovery                                     | Yes      |
| Skill   | `check`       | Check code quality (auto-discovers relevant specs)         | Yes      |
| Skill   | `break-loop`  | Post-debug analysis                                        | Yes      |
| Skill   | `update-spec` | Update code-spec docs                                      | Yes      |

> **Rule**: When a new command/single-file workflow skill is added, it is added to `src/templates/common/commands/` or `src/templates/common/skills/` — ALL platforms pick it up automatically via `resolveCommands()` / `resolveSkills()` / `resolveAllAsSkills()`. Check `src/templates/common/` as the reference source.

**Bundled built-in skills**: Multi-file skills with references/assets live under `src/templates/common/bundled-skills/<skill-name>/` and are installed through the same platform skill roots as workflow skills.

#### Scenario: Multi-file bundled skills

##### 1. Scope / Trigger

Use bundled skills when a built-in skill needs files beyond `SKILL.md`, such as `references/`, examples, or assets. Do not flatten large reference trees into `src/templates/common/skills/*.md`; single-file workflow skills stay there, while multi-file built-ins use `src/templates/common/bundled-skills/<skill-name>/`.

##### 2. Signatures

| Helper                                                    | Contract                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `getBundledSkillTemplates()`                              | Recursively reads `bundled-skills/*/` and returns POSIX relative file paths under each skill directory |
| `resolveBundledSkills(ctx)`                               | Resolves placeholders without adding frontmatter; bundled `SKILL.md` already owns frontmatter          |
| `collectSkillTemplates(skillRoot, skills, bundledSkills)` | Returns single-file workflow skills **and** bundled skill files as map entries under `skillRoot`       |

##### 3. Contracts

- Bundled skill source path: `src/templates/common/bundled-skills/<skill-name>/`.
- Bundled skill target path: `<platform-skill-root>/<skill-name>/<relative-file>`.
- `SKILL.md` inside a bundled skill owns its own YAML frontmatter; `wrapWithSkillFrontmatter()` must not be applied to bundled files.
- Relative file paths returned from the common template reader are POSIX-style, stable, and relative to the skill directory.
- `collectTemplates()` is the single description; `configure` writes it. Bundled skill files are covered by that guarantee automatically.

##### 4. Validation & Error Matrix

| Condition                                                            | Expected behavior                                                         |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bundled skill directory is missing                                   | Return no bundled skills; single-file workflow skill generation continues |
| Bundled skill has nested references                                  | Preserve the nested relative path under every platform skill root         |
| Bundled `SKILL.md` contains placeholders                             | Resolve placeholders with the platform `TemplateContext`                  |
| Platform omits `bundledSkills` from its `collectSkillTemplates()` call | That platform silently ships none of them. The parity oracle cannot see this — both paths agree, they just agree on the wrong set — so `test/templates/<platform>.test.ts` has to assert one bundled file by name |
| Bundled file path uses OS-specific separators                        | Normalize to POSIX relative paths before adding to template maps          |

##### 5. Good/Base/Bad Cases

- Good: `trellis-meta` installs as `<platform-skill-root>/trellis-meta/SKILL.md` plus `references/**`, and `collectPlatformTemplates(platform)` returns the same files.
- Base: no bundled skills exist; existing `resolveSkills()` / `resolveAllAsSkills()` behavior remains unchanged.
- Bad: platform-specific configurators copy `trellis-meta` manually, creating a second installer that update hash tracking can miss.

##### 6. Tests Required

- Init integration test proving at least Claude and Codex write `trellis-meta/SKILL.md` plus one reference file.
- Configurator test proving configured files are byte-for-byte equal to `collectPlatformTemplates()` for every platform that writes skills.
- Regression test proving `.trellis/.template-hashes.json` includes bundled skill reference files after init.
- Release smoke test when a changelog or docs page claims the skill is
  bundled: build the CLI, verify the skill appears in `npm pack --dry-run
--json` under `dist/templates/common/bundled-skills/<skill>/`, then run the
  built binary in a fresh temp repository and confirm both generated skill
  files and `.trellis/.template-hashes.json` contain the skill paths.

##### 7. Wrong vs Correct

Wrong:

```typescript
files.set(".claude/skills/trellis-meta/SKILL.md", metaSkillContent);
```

Correct:

```typescript
for (const [filePath, content] of collectSkillTemplates(
  skillRoot,
  resolveSkills(ctx),
  resolveBundledSkills(ctx),
)) {
  files.set(filePath, content);
}
```

**Rule**: Do not add a parallel installer for built-in multi-file skills. Every bundled file reaches disk through the platform's one template map, so `.trellis/.template-hashes.json` tracks it automatically. The failure this rule still guards is the quiet one: forgetting the third argument, which ships zero bundled skills on that platform with no test failure. Cover it with one reference file by name (for example `trellis-meta/references/core/template-pipeline.md`) in `test/templates/<platform>.test.ts`.

**Release rule**: A bundled skill is not release-ready until it has passed the
source, dist, generated-files, and update-tracking chain:
`src/templates/common/bundled-skills/<skill>/` ->
`dist/templates/common/bundled-skills/<skill>/` -> platform skill roots after
built-binary `trellis init` -> `.trellis/.template-hashes.json` -> built-binary
`trellis update --dry-run` with no pending changes.

### Step 5: Template Extraction

| File                       | Change                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/templates/extract.ts` | Only needed if platform has a physical template directory. Most new platforms generate from `common/` templates and don't need extraction functions |

> Note: Platforms using `createTemplateReader(import.meta.url)` in their `index.ts` handle their own template reading. The `extract.ts` functions (`getTrellisSourcePath()`, `readTrellisFile()`, `copyTrellisDir()`) are primarily for the `.trellis/` workflow files, not platform templates.

### Step 6: Python Scripts (independent runtime)

> **Warning**: `cli_adapter.py` uses if/elif/else chains with NO exhaustive check. New platforms silently fall through to the `else` branch (Claude defaults). You MUST add explicit branches for **every method** listed below.

| File                                                  | Change                                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/templates/trellis/scripts/common/cli_adapter.py` | Add to `Platform` literal type, `config_dir_name` property, `detect_platform()`, `get_cli_adapter()` validation |

**cli_adapter.py methods requiring explicit branches** (do NOT rely on `else` fallthrough):

| Method                       | What to decide                    | Example                                          |
| ---------------------------- | --------------------------------- | ------------------------------------------------ |
| `config_dir_name`            | Config directory name             | `".gemini"`, `".agent"`                          |
| `get_trellis_command_path()` | Command file path format          | `.toml` vs `.md`, subdirectory vs flat           |
| `get_non_interactive_env()`  | Non-interactive env var           | `{}` if none, or platform-specific               |
| `build_run_command()`        | CLI command for running agents    | `["gemini", prompt]` or raise ValueError         |
| `build_resume_command()`     | CLI command for resuming sessions | `["gemini", "--resume", id]` or raise ValueError |
| `cli_name`                   | CLI executable name               | `"gemini"`, `"agy"`                              |
| `detect_platform()`          | Directory detection logic         | Check `.gemini/` exists                          |
| `get_commands_path()`        | Command directory structure       | `commands/trellis/` or `workflows/`              |

> Note: Python scripts run in user projects at runtime — they cannot import from the TS registry and maintain their own registry in `cli_adapter.py`.

### Active Task Resolution

Current-task state is session/window scoped. New hook, statusline, plugin,
extension, and sub-agent consumers must call the shared resolver path:

| Runtime                         | Resolver surface                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Python hooks/statusline/scripts | `.trellis/scripts/common/active_task.py`                                                              |
| Existing Python callers         | `common.paths.get_current_task()` / `get_current_task_abs()` / `get_current_task_source()`            |
| OpenCode plugin                 | JS resolver in `lib/trellis-context.js`, mirroring `active_task.py`                                   |
| Pi extension                    | Extension-local resolver using `ctx.sessionManager.getSessionId()` and Bash `tool_call` env injection |
| Optional DSH companion          | Managed `DSH_TRELLIS_CONTEXT_ID` from the current shell execution's native DSH session                |

Do not add direct `.trellis/.current-task` reads in hooks, statusline scripts,
sub-agent context injection, or platform plugins. Direct reads reintroduce
multi-window task pollution.

Context-key precedence, as implemented in `active_task.py:resolve_context_key`
(`:478-540`):

1. Managed `DSH_TRELLIS_CONTEXT_ID`, when the optional `dsh-trellis` plugin
   contributes it for the current DSH shell execution.
2. The canonical DSH env-table identity when both `DSH_SHELL=1` and a non-empty
   `DSH_SESSION_ID` prove the process is inside a DSH managed shell.
3. `TRELLIS_CONTEXT_ID` environment override for subprocesses.
4. From the hook payload: `session_id`, `sessionId`, or `sessionID`.
5. From the hook payload: `conversation_id` / `conversationId` / `conversationID`.
6. From the hook payload: `transcript_path` / `transcriptPath` / `transcript`
   when non-empty.
7. A platform-native session environment variable — but only for the handful of
   names that have actually been verified to exist, and only for the platform
   the resolver detected (`_iter_env_keys` filters by platform name, so ZCode's
   entry cannot fire in a Claude session). Session names are tried first, then
   conversation names, then transcript names (`active_task.py:294-322`).
8. A short-lived shell ticket, checked **last** and **not** gated on platform
   name (`active_task.py:537-540`) — see "Shell-ticket bridge" below. Last on
   purpose: a platform that genuinely exports identity into the shell outranks
   a ticket written on its behalf.

The env tables live at `active_task.py:59-134`. Do not add a name to them by
analogy with a neighbour: a 2026-08-05 audit of all 21 platforms found 12 of
the 21 declared names had never existed anywhere. The provenance convention
that came out of it is in `script-conventions.md` → "Session env var names
carry their provenance", and it is binding on this file too — no platform's
session env var may be named here without the same grade of evidence.

Cursor IDE may send `transcript_path: null`; this must not prevent session
scoping when `session_id` or `conversation_id` is present.

DeepSeek Harness is the verified shell-env exception. It exposes
`DSH_SESSION_ID`, but an inner DSH process also inherits ordinary variables such
as an outer Claude/Codex session's `TRELLIS_CONTEXT_ID`; the generic override
would silently claim the inner task before the native table is consulted. DSH
discards ambient `DSH_*` values before rebuilding its managed namespace, so the
pair `DSH_SHELL=1` plus a non-empty `DSH_SESSION_ID` is trusted evidence for the
current DSH shell and its native table identity may outrank the generic override
without changing other platforms' semantics. The optional `dsh-trellis` plugin
additionally registers a managed
`DSH_TRELLIS_CONTEXT_ID = dsh_<session-id>` through DSH's `shellEnv` registry;
that forwarded identity remains first because a child may differ from the
shell's own session. Plugin-owned subprocess commands must also set
`TRELLIS_CONTEXT_ID` explicitly to the same DSH context key. Regression coverage
must pin the plugin-present and plugin-absent nested cases, assert that only the
`dsh_*` runtime pointer is written, and prove that `DSH_SESSION_ID` without the
`DSH_SHELL=1` sentinel does not displace an explicit generic override.

OpenCode has **no** entry in any env table. Its plugin holds the session
identity and injects it, so the plugin must prefix Bash tool commands in
`tool.execute.before` with a shell-aware `TRELLIS_CONTEXT_ID` assignment when
the command does not already set one: POSIX shells use
`export TRELLIS_CONTEXT_ID=<context-key>;`, while Windows PowerShell uses
`$env:TRELLIS_CONTEXT_ID = '<context-key>';`. That prefix is the only channel
by which an AI-run `task.py` sees an OpenCode session. Do not infer the
shell dialect from `process.platform` alone: on Windows, Git Bash / MSYS2 still
parse POSIX syntax. OpenCode must treat `MSYSTEM`, `MINGW_PREFIX`,
`OSTYPE=msys|mingw|cygwin`, `SHELL=...bash`, or `OPENCODE_GIT_BASH_PATH` as
POSIX-shell signals and keep PowerShell as the Windows default only when no
POSIX-shell signal is present.
Regression tests must cover both families: `win32` with no POSIX-shell signal
emits the PowerShell prefix, while `win32` with each supported POSIX-shell
signal emits the `export` prefix. Existing explicit-assignment dedupe tests
must continue to cover POSIX, `env ... TRELLIS_CONTEXT_ID=...`, and PowerShell
forms.

> **`OPENCODE_RUN_ID` is not an input on either side.** It was real on OpenCode
> ~1.14.x — observed live in an `opencode run` bash child alongside
> `OPENCODE_PID` / `OPENCODE_PROCESS_ROLE` — and upstream dropped it: the
> 1.17.18 binary carries 82 other `OPENCODE_*` names but neither
> `OPENCODE_RUN_ID` nor `PROCESS_ROLE`, and 1.18.13's source has zero hits.
> Python purged it on 2026-08-05 (`PURGED_ENV_NAMES`); the JS resolver's branch
> went on 2026-08-06. Both sides are now test-locked to ignore it
> (`regression.test.ts` "task.py start ignores OPENCODE_RUN_ID" and "OpenCode
> resolver ignores OPENCODE_RUN_ID and uses the plugin sessionID"). The one
> place it ever fired was a stray host-shell export hijacking a resolver, which
> is why `test/setup.ts` had to scrub it. Do not treat it as a precedent for
> adding env names.

Pi Agent exposes its real session identity through the extension context, not
through ordinary Bash environment. The generated `.pi/extensions/trellis/index.ts`
extension must read `ctx.sessionManager.getSessionId()`, derive the same
`pi_<session-id>` context key for context injection and sub-agent launches, and
prefix Bash tool calls in `tool_call` with
`export TRELLIS_CONTEXT_ID=<context-key>;` when the command does not already set
one.
Copilot should use
`session_id` / `sessionId` only if the actual payload provides it; otherwise it
has no active task.

`task.py start <task>` has no hook stdin when it is run as a normal shell
command. It can write session-local state only when a context key is available
through `TRELLIS_CONTEXT_ID` or a platform-native environment variable exposed
by the host. Hooks and plugins should pass `TRELLIS_CONTEXT_ID` to subprocesses
they launch. Claude Code is special: SessionStart provides `CLAUDE_ENV_FILE`,
so the shared hook must persist `export TRELLIS_CONTEXT_ID=<context-key>` there
for later Bash tool calls in the same conversation. OpenCode is also special:
there is no env-file bridge, so the JS plugin must prefix Bash tool commands
with a shell-aware `TRELLIS_CONTEXT_ID` assignment using plugin session identity
before execution; on Windows, this must be shell-dialect-aware rather than a
plain `process.platform === "win32"` check. **No researched platform has a
reliable command-env bridge** — that is the general finding, not a Cursor
quirk — so every hook-capable platform with a pre-shell event gets the shell
ticket instead (see below). Without one of these session signals, `task.py
start` must fail with a clear session identity hint and must not write
`.trellis/.current-task`.
Pi is extension-backed rather than Python-hook-backed: `tool_call` must mutate
`event.input.command` before Bash execution. It must not register a child execution tool.

#### Shell-ticket bridge (platform-neutral)

The premise: no researched platform exports a session id into its shell tool's
child process, but every hook-capable one puts that id on hook stdin. So a hook
registered on the host's pre-shell event writes a short-lived ticket, and
`task.py` reads it back.

`inject-shell-session-context.py` is that writer. It ships to **cursor, gemini,
qoder, codebuddy, droid, trae, zcode** (`shared-hooks/index.ts:106-145`) — not
Cursor alone — and is registered on whichever pre-shell event the host offers:
Cursor's `beforeShellExecution`, Claude-shaped `PreToolUse`, or Gemini's
`BeforeTool`. Kiro is deliberately absent; the reason is in the declaration
comment.

The current ticket directory is `.trellis/.runtime/shell-tickets/`.
`cursor-shell/` is the pre-0.6.13 name from when the bridge was Cursor-only —
still read so a command in flight across an upgrade does not degrade, **never**
written.

The full contract — payload shape, the four acceptance conditions, and the
install-directory rule that decides the ticket's context key — is in
`script-conventions.md` → "Shell-ticket bridge". Read it before wiring the hook
into a new platform's config: getting the context key wrong makes `task.py
start` write a session file no hook ever reads, which half-works behind the
single-session fallback and breaks silently with two windows open.

Hook, statusline, or plugin output that mentions an active task should include
the source (`session` or `session:<key>`) so cross-window mistakes are visible
while debugging. Statuslines may shorten this to `[session]` to avoid noisy UI.

**Also update `task_store.py` when adding a sub-agent-capable platform**:

| File                                                 | Constant                        | When to update                                                                                                              |
| ---------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/templates/trellis/scripts/common/task_store.py` | `_SUBAGENT_CONFIG_DIRS` (tuple) | Add `.{configDir}/` if the new platform can spawn sub-agents (Class-1 hook-inject, Class-2 pull-based, or extension-backed) |

This tuple is consulted by `cmd_create` to decide whether to seed `implement.jsonl` / `check.jsonl` for the new task. Agent-less platforms (Kilo, Antigravity, Devin) MUST be excluded — they don't consume jsonl.

Same root reason as `cli_adapter.py`: Python scripts run at user-project runtime and can't import from the TS `AI_TOOLS` registry, so they maintain their own parallel registry. When adding/removing sub-agent capability, update both in tandem.

> **Codex-specific CLIAdapter notes:**
>
> - `config_dir_name` returns `".codex"` (not `".agents"`)
> - `get_agent_path` returns `.toml` for codex (not `.md`)
> - `requires_agent_definition_file` is `False` — Codex auto-discovers agents from `.codex/agents/*.toml`, no `--agent` CLI flag
> - `detect_platform` checks `.codex/` existence (not `.agents/skills/`)

**Repo-global, not Codex-specific**: the shipped script tree
(`packages/cli/src/templates/trellis/scripts/`) and Trellis's own dogfood copy
(`.trellis/scripts/`) must stay byte-identical. This is now build-enforced —
see `script-conventions.md` → "Two script trees, one content".

### Step 7: Documentation

| File           | Change                                         |
| -------------- | ---------------------------------------------- |
| `README.md`    | Add platform to supported tools list           |
| `README_CN.md` | Add platform to supported tools list (Chinese) |

### Step 8: Build Scripts

| File                        | Change                                                      |
| --------------------------- | ----------------------------------------------------------- |
| `scripts/copy-templates.js` | No change needed (copies entire `src/templates/` directory) |

### Step 9: Project Config (Optional)

If Trellis project itself should support the new platform:

| Directory                       | Contents                       |
| ------------------------------- | ------------------------------ |
| `.{platform}/`                  | Project's own config directory |
| `.{platform}/commands/trellis/` | Slash commands                 |
| `.{platform}/agents/`           | Agents                         |
| `.{platform}/hooks/`            | Hooks                          |
| `.{platform}/settings.json`     | Settings                       |

### Step 10: Gitignore

| File         | Change                                                    |
| ------------ | --------------------------------------------------------- |
| `.gitignore` | Add local config patterns (e.g., `{platform}.local.json`) |

### Step 11: Tests (MANDATORY)

> **Warning**: Dynamic iteration tests (e.g., `PLATFORM_IDS.forEach`) only verify registry metadata. They do NOT cover platform-specific runtime behavior. You MUST add explicit tests.

| Test File                                | What to Add                                                                                                                                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/templates/{platform}.test.ts`      | **NEW FILE**: Verify the platform's template-module readers (`getAllAgents()`, `getAllHooks()`, `getHooksConfig()`, `getSettings()` — whichever it exposes) return the expected set, content non-empty, format valid. Assert one bundled skill file by name if the platform ships them |
| `test/configurators/platforms.test.ts`   | Detection test: `getConfiguredPlatforms` recognizes tracked Trellis templates but ignores native platform directories. Content test: `configurePlatform` writes the expected paths, no compiled artifacts. **The `configure` ⟷ `collectTemplates` parity assertions are registry-wide and cover a new platform automatically — do not copy them per platform** |
| `test/commands/init.integration.test.ts` | Init test: `init({ {platform}: true })` creates correct directory. Negative assertions: add `.{configDir}` checks to existing platform tests                                                                            |
| `test/templates/extract.test.ts`         | `get{Platform}TemplatePath()` returns existing dir. `get{Platform}SourcePath()` deprecated alias equals template path                                                                                                   |
| `test/regression.test.ts`                | Platform registration: `AI_TOOLS.{platform}` exists with correct `configDir`. cli_adapter: `commonCliAdapter` contains `"{platform}"` and `".{configDir}"`. Update `withTracking` list if `collectTemplates` is defined |

For extension-backed platforms like Pi Agent, add explicit regression coverage that no Python hook files are installed under the platform config directory and that the generated extension exposes the required sub-agent and hook-equivalent event surface.

---

## Declaring a shared hook is half the wiring

### 1. Scope / Trigger

Infra wiring: a hook script only runs if two independent things agree — the
distribution table that puts the file on disk, and the platform's own hook
config that invokes it. Those cannot be derived from one another, because each
vendor defines its own config format. A script on disk that nothing invokes is
indistinguishable from success: the file is there, the test that checks the
file is there passes, and the feature does nothing.

### 2. Signatures

```typescript
// templates/shared-hooks/index.ts:95-149 — the distribution half
export const SHARED_HOOKS_BY_PLATFORM: Record<
  SharedHookPlatform,
  readonly SharedHookName[]
>;

// configurators/shared.ts:571 — reads that table into the platform's map
export function collectSharedHooks(
  hooksPath: string,
  platform: SharedHookPlatform,
): Map<string, string>;
```

The invocation half has no shared signature — it is a literal inside each
platform's own config template (`settings.json`, `hooks.json`, `config.json`,
`.kiro.hook`, the agent JSON's `hooks` object …).

### 3. Contracts

- `SharedHookPlatform` is a string-union type, so a platform not in the union
  cannot be passed to `collectSharedHooks` at all. That is the guard for
  extension-backed platforms.
- Declaring `"inject-shell-session-context.py"` for a platform obliges its
  config template to invoke `hooks/inject-shell-session-context.py` on
  whichever pre-shell event the host publishes.
- The reverse also binds: a config that invokes a shared hook the platform does
  not declare points at a path that will never exist on disk.
- The hooks path passed to `collectSharedHooks` must be the same directory the
  config template references. There is no cross-check on that string beyond the
  substring match below, so a typo in one of the two shows up as a build
  failure, not a runtime one.

### 4. Validation & Error Matrix

Both directions are asserted in `test/templates/shared-hooks.test.ts:97-155`.
"Registration" means a non-`.md` file in the platform's template map contains
the substring `hooks/<hook-name>` — markdown is excluded because reference
tables name the file without invoking it.

| Condition | Failure |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Platform declares the hook, no config template invokes it | "`<platform>` declares … but no `<platform>` config template invokes it — the script would be installed and never run" |
| Config template invokes it, platform does not declare it | "`<platform>` invokes … but does not declare it — the config points at a script that is never installed" |
| The filter stops matching anything (renamed hook, changed path shape) | `expect(declaring.length).toBeGreaterThan(0)` fails first, so the suite cannot pass vacuously |
| Platform in `SHARED_HOOKS_BY_PLATFORM` matches no `AI_TOOLS` cliFlag | `registrationsOf` throws |
| Platform collects no templates | `registrationsOf` throws — its config cannot be checked |

### 5. Good / Base / Bad Cases

- **Good** — a platform gains a pre-shell event: add it to the table _and_ add the invocation to its config template, in the same change. The test proves both halves landed.
- **Base** — Kiro. Deliberately **not** wired: neither of its two hook surfaces (CLI agent JSON `hooks.{agentSpawn,userPromptSubmit}` and IDE `.kiro.hook` `when.type`) publishes a pre-tool trigger, and an unknown key in the agent JSON risks the whole agent failing to load. The probe that would settle it is recorded in the declaration comment — run Kiro, check its hook trigger list.
- **Bad** — declaring the hook and "wiring it later". The file ships, `trellis update` starts managing it, users see it in their repo, and nothing calls it. This is precisely the state the test now makes unreachable.

### 6. Tests Required

- Both direction assertions above, derived from `SHARED_HOOKS_BY_PLATFORM` — never from a hard-coded platform list.
- A non-vacuity assertion on the filter itself. Without it, renaming the hook turns every other assertion into a no-op that still passes.
- Per-platform registration tests for the hooks whose config shape is unusual (`shared-hooks.test.ts` has explicit ones for kiro and zcode).

### 7. Wrong vs Correct

#### Wrong

```typescript
// shared-hooks/index.ts
foo: ["session-start.py", "inject-shell-session-context.py"],
```

with `templates/foo/hooks.json` unchanged. `.foo/hooks/inject-shell-session-context.py` is written, hash-tracked, and never executed.

#### Correct

```typescript
// shared-hooks/index.ts
foo: ["session-start.py", "inject-shell-session-context.py"],
```

```jsonc
// templates/foo/hooks.json — the other half
{
  "beforeShellExecution": [
    { "command": "{{PYTHON_CMD}} .foo/hooks/inject-shell-session-context.py" },
  ],
}
```

---

## Extension-backed main sessions

Pi and Oh My Pi extensions supply main-session context, workflow state, session identity and cache/compaction lifecycle. Pi retains its explicit start fallback because `session_start` is notify-only. Neither extension registers a child execution tool or starts a provider process. Test initial context, later task updates, session isolation, shell identity and failure handling independently.

## What You DON'T Need to Update

These are now **automatically derived** from the registry:

| Previously hardcoded                          | Now derived from                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `BACKUP_DIRS` in update.ts                    | `ALL_MANAGED_DIRS` from `configurators/index.ts`                       |
| `TEMPLATE_DIRS` in template-hash.ts           | `ALL_MANAGED_DIRS` from `configurators/index.ts`                       |
| `getConfiguredPlatforms()` in update.ts       | `getConfiguredPlatforms()` from `configurators/index.ts`               |
| `cleanupEmptyDirs()` whitelist in update.ts   | `isManagedPath()` / `isManagedRootDir()` from `configurators/index.ts` |
| `collectTemplateFiles()` if/else in update.ts | `collectPlatformTemplates()` dispatch loop                             |
| `TOOLS[]` in init.ts                          | `getInitToolChoices()` from `configurators/index.ts`                   |
| Configurator dispatch in init.ts              | `configurePlatform()` from `configurators/index.ts`                    |
| Windows Python detection in init.ts           | `getPlatformsWithPythonHooks()` from `configurators/index.ts`          |

---

## Command Format by Platform

| Platform    | Command Format                                                         | File Format                                                   | Example (finish-work)        |
| ----------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------- |
| Claude Code | `/trellis:xxx`                                                         | Markdown (`.md`)                                              | `/trellis:finish-work`       |
| Cursor      | `/trellis-xxx`                                                         | Markdown (`.md`)                                              | `/trellis-finish-work`       |
| OpenCode    | `/trellis:xxx`                                                         | Markdown (`.md`)                                              | `/trellis:finish-work`       |
| Gemini CLI  | `/trellis:xxx`                                                         | TOML (`.toml`)                                                | `/trellis:finish-work`       |
| Kilo        | `/<workflow-name>`                                                     | Markdown (`.md`)                                              | `/finish-work`               |
| Codex       | `$<skill-name>` / `/skills`                                            | Markdown (`SKILL.md`)                                         | `$finish-work`               |
| Kiro        | `$<skill-name>` / `/skills`                                            | Markdown (`SKILL.md`)                                         | `$finish-work`               |
| Qoder       | `/trellis-<name>` (commands) + `$<skill-name>` / `/skills` (workflows) | Markdown (`.md` with frontmatter + `SKILL.md`)                | `/trellis-finish-work`       |
| Antigravity | `/<workflow-name>`                                                     | Markdown (`.md`)                                              | `/finish-work`               |
| CodeBuddy   | `/trellis:xxx`                                                         | Markdown (`.md`)                                              | `/trellis:finish-work`       |
| Copilot     | `/trellis:xxx`                                                         | Markdown (`.prompt.md`)                                       | `/trellis:finish-work`       |
| Droid       | `/trellis:xxx`                                                         | Markdown (`.md`)                                              | `/trellis:finish-work`       |
| Devin       | `/trellis-xxx`                                                         | Markdown (`.md`) + `SKILL.md`                                 | `/trellis-finish-work`       |
| Pi Agent    | `/trellis-xxx` prompt templates + `/skill:<name>` skills               | Markdown (`.md`) + `SKILL.md` + TypeScript extension          | `/trellis-finish-work`       |
| Trae IDE    | `/trellis-xxx` commands + skills                                       | Markdown (`.md` with frontmatter) + `SKILL.md` + `hooks.json` | `/trellis-finish-work`       |
| Oh My Pi    | `/trellis-xxx`                                                         | Markdown (`.md` with YAML frontmatter) + TypeScript extension | `/trellis-finish-work`       |
| Kimi Code   | `/skill:trellis-<name>` skills                                         | Markdown (`SKILL.md`)                                         | `/skill:trellis-finish-work` |
| Reasonix    | `/skill trellis-<name>`                                                | Markdown (`SKILL.md`)                                         | `/skill trellis-finish-work` |
| ZCode       | `/trellis:xxx`                                                         | Markdown (`.md`) + `SKILL.md` + `config.json`                 | `/trellis:finish-work` |
| Grok Build  | `/trellis-xxx`                                                         | Markdown (`.md`) + `SKILL.md`                                 | `/trellis-finish-work` |
| Snow CLI    | `/trellis-xxx`                                                         | JSON prompt commands (`.json`) + `SKILL.md`                   | `/trellis-finish-work` |

When creating platform templates, ensure references match the platform's interaction format and file format. The authoritative prefix is `AI_TOOLS[id].templateContext.cmdRefPrefix` — this table restates it for orientation, so check the registry when they disagree.

## Command delivery

Shared command filtering depends on `hasHooks`, with explicit main-session start fallbacks where the host needs them. Skill delivery and host event support do not grant delegation authority. The platform registry contains no agent-capability or executor placeholder policy.

## Planning artifacts and optional context manifests

Task CLI creates task metadata and PRD without seeding role context. `add-context` creates the selected implement/check manifest lazily. Existing JSONL remains ordinary data; missing `file` rows are not references. Readers load the current phase, accepted contract, artifacts and relevant specs. Source files are inspected during implementation or review, not pre-registered as spec context.

## Main-session context budgets

`common.config.get_context_injection_limits()` and Pi/Oh My Pi context readers use `context_injection.max_file_bytes` (32768), `max_artifact_bytes` (65536) and `max_total_bytes` (131072). Zero disables a limit; invalid values use the documented default. Preserve UTF-8 boundaries, binary detection and explicit truncation/degradation notices. Test main-session budget behavior and task context validation; no removed role Hook or OpenCode materializer is a consumer.

## Parent / Child Task Tree Contract

### Scope / Trigger

Use parent/child task trees when a request contains multiple deliverables that can be planned, implemented, checked, and archived independently. The hierarchy is for work structure and review scope, not for dependency scheduling.

### Signatures

```bash
python3 ./.trellis/scripts/task.py create "<title>" --description "<one-line summary>" --slug <name> --parent <parent-dir>
python3 ./.trellis/scripts/task.py add-subtask <parent-dir> <child-dir>
python3 ./.trellis/scripts/task.py remove-subtask <parent-dir> <child-dir>
```

### Contracts

| Contract              | Enforcer                                      | Behavior                                                                                                                          |
| --------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| New child creation    | `task_store.py`                               | `create --parent` writes the child's `parent` field and appends the child directory name to the parent's `children` list.         |
| Existing task link    | `task_store.py`                               | `add-subtask` links two existing active tasks; the child must not already have a different parent.                                |
| Unlink                | `task_store.py`                               | `remove-subtask` removes the child from the parent's `children` and clears the child's `parent`.                                  |
| Parent responsibility | workflow / skills                             | Parent task owns source requirements, task map, cross-child acceptance, and final integration review.                             |
| Child responsibility  | workflow / skills                             | Child task owns one independently verifiable deliverable, including its own dependencies and acceptance criteria.                 |
| Archive progress      | `script-conventions.md` / `children_progress` | Parent `children` is historical. Archiving a child does not prune it from the parent; missing active children count as completed. |

### Good / Base / Bad Cases

- **Good**: parent task records the overall requirement set and lists child deliverables; each child has its own PRD and any ordering dependency is written in that child's planning artifacts.
- **Base**: a single lightweight task uses no parent/child structure.
- **Bad**: parent task is started as a generic "manager" implementation task while child tasks are the only real deliverables.
- **Bad**: one child depends on another but the dependency is only implied by the parent/child tree. The child artifact must state the dependency explicitly.

### Tests Required

- Workflow template guidance must mention when to use parent/child task trees and where dependency ordering belongs.
- Task system references must match the archive invariant in `script-conventions.md`.

---

## Workflow Step Detail Loading

`.trellis/workflow.md` contains per-phase step detail under `#### X.X` headings, with per-platform variants demarcated by `[Platform Name, ...]` … `[/Platform Name, ...]` blocks.

Load step detail on demand (both commands and hooks use this):

```bash
python3 ./.trellis/scripts/get_context.py --mode phase                                   # Phase Index (no --step)
python3 ./.trellis/scripts/get_context.py --mode phase --step 1.1                        # Step 1.1 (all platforms)
python3 ./.trellis/scripts/get_context.py --mode phase --step 1.2 --platform cursor      # Step 1.2, cursor-filtered
```

Platform markers are filtered by matching `[...]` block membership against the given platform name (case-insensitive; accepts `claude-code` and `Claude Code`). Lines outside any marker block are always kept.

---

## Windows Encoding Fix

All hook scripts that output to stdout must include the Windows encoding fix.
This includes platform-specific `session-start.py` copies that opt out of
`shared-hooks/session-start.py` (`codex/hooks/session-start.py` and
`copilot/hooks/session-start.py`), because they still print JSON payloads with
`ensure_ascii=False`.

When a hook can resolve the Trellis project directory before printing, prefer
the shared helper from `.trellis/scripts/common/__init__.py`:

```python
def configure_project_encoding(project_dir: Path) -> None:
    scripts_dir = project_dir / ".trellis" / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))

    try:
        from common import configure_encoding  # type: ignore[import-not-found]

        configure_encoding()
    except Exception:
        pass
```

Call it after resolving `project_dir` and before `json.dumps(...,
ensure_ascii=False)` is printed.

For standalone hooks that cannot safely import `.trellis/scripts/common`, use
the local fallback pattern:

```python
# IMPORTANT: Force stdout to use UTF-8 on Windows
# This fixes UnicodeEncodeError when outputting non-ASCII characters
if sys.platform == "win32":
    import io as _io
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    elif hasattr(sys.stdout, "detach"):
        sys.stdout = _io.TextIOWrapper(sys.stdout.detach(), encoding="utf-8", errors="replace")  # type: ignore[union-attr]
```

### Tests Required

- Regression coverage must assert every platform-specific Python
  `session-start.py` template contains:
  - `from common import configure_encoding`
  - `configure_encoding()` before printing JSON
  - `ensure_ascii=False` at the JSON output boundary
- When a platform copies rather than consumes `shared-hooks/session-start.py`,
  treat Windows stdout encoding as part of the copied contract, not as an
  optional implementation detail.

---

## SessionStart Hook: additionalContext Size Constraint

### Adaptive First-Reply Notice

#### 1. Scope / Trigger

Trellis uses a one-shot visible acknowledgment as proof that otherwise-hidden
SessionStart context loaded. This contract applies to every live implementation
that already provides that proof: the shared Python hook used by Claude Code,
Cursor, Gemini, Qoder, CodeBuddy, Droid, Kiro, Trae, and ZCode; the Codex hook;
OpenCode's startup plugin; and Pi's SessionStart-equivalent
`before_agent_start` context.

The acknowledgment is an instruction inside the existing context string, not a
new payload field or host UI feature. Copilot remains notice-free until its
model-visible consumption is verified end to end.

#### 2. Signatures

| Implementation                                               | Injection signature                                                                                                             | Adaptive notice? |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------: |
| `shared-hooks/session-start.py`                              | Existing shared hook output (`hookSpecificOutput.additionalContext` plus host-specific aliases, or Kiro's plain stdout context) |              Yes |
| `codex/hooks/session-start.py`                               | Existing Codex SessionStart payload when hooks are enabled and approved                                                         |              Yes |
| `opencode/lib/session-utils.js` + `plugins/session-start.js` | Compact context prepended to the first user message and marked for persistence                                                  |              Yes |
| `pi/extensions/trellis/index.ts.txt`                         | Memoized SessionStart-equivalent context added to `before_agent_start.systemPrompt`                                             |              Yes |
| `copilot/hooks/session-start.py`                             | Microsoft's documented `SessionStart.hookSpecificOutput.additionalContext` payload                                              |               No |

The **update-hint rider** (see below) is narrower still — it exists only in
`shared-hooks/session-start.py`. Codex's own `session-start.py`, the OpenCode
plugin, and the Pi extension each build their own payload and do not carry it.

#### 3. Contracts

- Put `<first-reply-notice>` near the top of model-visible startup context,
  before current-state or other orientation blocks.
- On the first visible assistant reply, briefly acknowledge that Trellis
  SessionStart context loaded, then continue directly with the user's request.
- Choose the acknowledgment language in this exact order:
  1. the language of the user's current request, meaning the user message that
     triggered the first visible reply;
  2. if that request has no clear natural language, an explicitly established
     project communication language;
  3. if neither provides a language, the language-neutral fallback exactly
     `Trellis SessionStart ✓`.
- The acknowledgment must not alter the language used for the remainder of the
  response.
- Emit the acknowledgment only once per session. Do not repeat it on later
  assistant replies.
- Do not infer a fallback language from operating-system locale, source files,
  README frequency, commit history, or other repository content.
- Keep hook payload keys, compact context content, event timing, and
  per-session deduplication unchanged.
- OpenCode persists startup context once per session. Pi memoizes identical
  startup `systemPrompt` bytes per context key.
- **The Trellis update reminder rides this block, and only this block.** When
  `get_update_hint()` returns a hint, exactly one line is inserted between the
  notice head and tail: `Also relay this Trellis maintenance notice on its own
  line in that same reply: {update_hint}`. When it returns `None` the notice is
  **byte-identical** to the plain `FIRST_REPLY_NOTICE` constant — no empty
  block, no placeholder line, nothing to diff. See "SessionStart update
  reminder" below.

#### 4. Validation & Error Matrix

| Condition                                                                                                    | Required behavior                                                                               |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| First request has a clear natural language                                                                   | Acknowledgment uses that request language; the rest of the response keeps its intended language |
| Request has no clear natural language and project instructions explicitly establish a communication language | Acknowledgment uses the explicit project language                                               |
| Neither request nor project instructions provide a language                                                  | Acknowledgment is exactly `Trellis SessionStart ✓`                                              |
| Later assistant reply in the same session                                                                    | No repeated acknowledgment                                                                      |
| Repeated OpenCode message in one session                                                                     | Startup context is not prepended again                                                          |
| Repeated Pi turn with the same context key                                                                   | Memoized startup `systemPrompt` bytes remain stable                                             |
| Shared or Codex hook output                                                                                  | Existing payload keys and `SessionStart` event name remain unchanged                            |
| Copilot SessionStart                                                                                         | Context remains notice-free                                                                     |

#### 5. Good / Base / Bad Cases

- **Good:** an English request receives a brief English proof-of-load sentence,
  then the requested work continues in English.
- **Base:** a code-only request in a project that explicitly establishes Japanese
  as its communication language receives a brief Japanese acknowledgment.
- **Fallback:** a request and project with no language signal receive
  `Trellis SessionStart ✓`, then processing continues directly.
- **Bad:** the notice says `say once in Chinese`, requires `exactly one short
Chinese sentence`, includes a fixed Chinese acknowledgment, or causes the
  remainder of an otherwise non-Chinese response to switch languages.

#### 6. Tests Required

- Execute shared and Codex hook templates; assert exact payload shape, normal
  compact context blocks, the adaptive priority, neutral fallback, one-shot
  rule, and absence of fixed Chinese wording.
- Build OpenCode context and exercise its plugin entry point; assert adaptive
  notice content, first-message prefix and persistence, and no second injection
  in the same session.
- Exercise Pi `before_agent_start`; assert normal startup/workflow context,
  adaptive notice content, and byte-stable memoized `systemPrompt` behavior.
- Keep Copilot regression assertions notice-free.
- Validate the injected instruction contract deterministically. Do not attempt
  to test an LLM's actual language classification in template tests.

#### 7. Wrong vs Correct

```text
# Wrong: fixed language steers the conversation
<first-reply-notice>Say once in Chinese that Trellis loaded.</first-reply-notice>

# Correct: request language -> explicit project language -> neutral fallback
<first-reply-notice>
Use the language of the user message that triggered this reply. If it has no
clear natural language, use an explicitly established project communication
language. Otherwise output exactly `Trellis SessionStart ✓`. Continue directly
without altering the language of the remainder of the response. Emit once.
</first-reply-notice>
```

### SessionStart update reminder

#### 1. Scope / Trigger

Cross-layer contract change: a Python module's private helper became public and
gained a second caller in a different layer (the shared hook), and that caller
changes user-visible output. The reminder previously existed only on the
`get_context.py` text-mode path, so hook-driven platforms — Claude Code
included — never saw it. This repo ran ten versions behind before anyone
noticed.

#### 2. Signatures

```python
# .trellis/scripts/common/session_context.py:460
def get_update_hint(repo_root: Path, context_key: str | None = None) -> str | None

# .trellis/scripts/common/session_context.py:421 (private)
def _update_marker_path(repo_root: Path, context_key: str | None = None) -> Path

# shared-hooks/session-start.py:322 (private)
def _resolve_update_hint(trellis_dir: Path, context_key: str | None) -> str | None

# shared-hooks/session-start.py:85 (private)
def _build_first_reply_notice(update_hint: str | None) -> str
```

#### 3. Contracts

- `get_update_hint` returns `"Trellis update available: {current} -> {latest}, run trellis update"` or `None`. It is public because two layers call it; do not re-privatize.
- `context_key` is **passed in, not re-resolved**. The hook already read the session id from hook stdin; that is more reliable than `session_context`'s environment-only fallback chain. Shell entry points pass nothing and keep the old behavior.
- The once-per-session marker is `.trellis/.runtime/update-check-{safe_key}.marker`, where `safe_key` is the sanitized context key truncated to 160 chars. With no context key it falls back to `TERM_SESSION_ID`, then `ppid-{n}`. **That fallback is why the key must be threaded through**: `TERM_SESSION_ID` identifies a terminal _window_, so the marker would mute the reminder for every later session opened in the same window.
- The marker is written before the version comparison, not after, so a probe that finds no update still costs one `trellis --version` per session rather than one per turn.
- The whole path is best-effort. A missing scripts dir, an import error, or any exception while probing versions leaves the payload untouched (`session-start.py:341` catches bare `Exception` on purpose).
- Scope is the shared hook only. Codex's own `session-start.py`, the OpenCode plugin, and the Pi extension build their own payloads and do not carry the rider.

#### 4. Validation & Error Matrix

| Condition | Behavior |
| ------------------------------------------------ | ----------------------------------------------------------- |
| Marker already exists for this context key | `None` — no version probe at all |
| No project version readable | `None` |
| Version probe fails, hangs, or the CLI is absent | `None`, marker **not** written, so the next session retries |
| Current version ≥ latest | Marker written, `None` returned |
| Current version < latest | Marker written, hint returned |
| Hint is `None` | Notice is byte-identical to `FIRST_REPLY_NOTICE` |
| Scripts dir missing / import fails | `None`; SessionStart context still emitted normally |

#### 5. Good / Base / Bad Cases

- **Good:** a session on an outdated install gets one extra line inside `<first-reply-notice>`, the model relays it on its own line in the first reply, and no later turn repeats it.
- **Base:** an up-to-date install produces the unchanged notice, byte for byte. This is the property to assert — it is what proves the feature is invisible when it has nothing to say.
- **Bad:** the reminder is added as a separate context block. It then lives where `<first-reply-notice>` does not — model context nobody reads — which is the exact failure this change fixed.

#### 6. Tests Required

- `regression.test.ts` `[session-update-hint]`: assert the hint line appears between head and tail when a newer version is available. Assertion point is the rendered payload string, not `get_update_hint`'s return value.
- Assert byte-identity of the notice against `FIRST_REPLY_NOTICE` when no hint exists.
- Assert a failing or hanging `trellis` CLI leaves the payload untouched **and** leaves the check for the next session (covered by "[session-update-hint] a failing or hanging trellis CLI stays silent and leaves the check for the next session").
- Assert the marker filename derives from the passed context key, not from `TERM_SESSION_ID`, when both are present.

#### 7. Wrong vs Correct

##### Wrong

```python
# A second, always-present block
blocks.append(f"<trellis-update>{get_update_hint(repo_root)}</trellis-update>")
```

Two problems: it emits an empty block when there is no hint (so every payload differs from the previous release's bytes), and it lands in a channel the model reads but never speaks.

##### Correct

```python
notice = _build_first_reply_notice(_resolve_update_hint(trellis_dir, context_key))
```

One line inside the block that is already contracted to become spoken output; identical bytes to the plain constant when there is nothing to say.

### Per-Platform Output Schema

`shared-hooks/session-start.py` is consumed by hosts with **different sessionStart output schemas**. It must emit both shapes so every host reads the context it expects:

```python
{
    # Claude / Gemini / Qoder / CodeBuddy / Droid / Copilot — nested camelCase
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": context_text,
    },
    # Cursor — top-level snake_case per cursor.com/docs/agent/hooks
    "additional_context": context_text,
}
```

Each host ignores keys it does not recognize, so dual emission is safe. **Do not refactor to single-format output** — dropping the Cursor key breaks Cursor's auto-context injection for all models (not just GPT).

### Constraint

Claude Code truncates `hookSpecificOutput.additionalContext` at **~20 KB**. When exceeded, only a ~2 KB preview is shown and the full payload is written to a fallback file (`tool-results/hook-*-additionalContext.txt`). AI agents do **not** proactively read the fallback file, so any content past the preview is effectively invisible.

Codex has even tighter limits — users report 40-80 KB payloads consuming most of the context window on large projects.

### Size Budget (measured on Trellis dev repo)

| Block                |       Size | Notes                                                                                                                                 |
| -------------------- | ---------: | ------------------------------------------------------------------------------------------------------------------------------------- |
| `<session-context>`  |     0.1 KB | Fixed                                                                                                                                 |
| `<current-state>`    |     0.3 KB | Compact developer/git/task state                                                                                                      |
| `<trellis-workflow>` |     4.4 KB | Compact Phase Index after stripping workflow-state blocks, comments, and platform markers; detailed phase bodies are loaded on demand |
| `<guidelines>`       |     0.5 KB | Context order + spec index paths only                                                                                                 |
| `<ready>`            |     0.1 KB | Fixed                                                                                                                                 |
| **Total**            | **6.0 KB** | **Under 20 KB ✓**                                                                                                                     |

Historical note: pre-workflow-rewrite (v0.4.0-beta.10) the payload included a 16 KB `<instructions>` block (start.md content). Later iterations injected a large `<workflow>` block. Current SessionStart uses `<trellis-workflow>` with a compact Phase Index and leaves detailed steps to `/trellis:continue` / phase-context loading.

### Guidelines: Paths-only

Before: every `.trellis/spec/*/index.md` was inlined in `<guidelines>` (10 KB+
on this repo). Main agents rarely need every index at SessionStart, and
sub-agents receive their specific spec / research context through
`implement.jsonl` / `check.jsonl` or pull-based prelude loading.

Now: `<guidelines>` contains only the artifact read order and available spec
index paths, including `.trellis/spec/guides/index.md`. Agents read the relevant
index on demand after the task and phase are known.

### Task Status Guidance

`SessionStart` reports task status and artifact presence, but it does not
approve implementation. Planning tasks stay behind the review gate: lightweight
tasks may be PRD-only, while complex tasks need `prd.md`, `design.md`, and
`implement.md` before `task.py start`.

For `in_progress` tasks, `SessionStart` points the AI to the per-turn
`<workflow-state>` block and restates the implementation/check context order.
Dispatch-vs-inline behavior belongs to workflow-state, skills, and agent
definitions, not to a large SessionStart instruction block.

### Design Decision: Inject Orientation, Not References

**Context**: earlier SessionStart payloads injected full `workflow.md`, full
`get_context.py` output, and sometimes command-sized instruction blocks. Large
repositories crossed host truncation thresholds, leaving the AI with a preview
instead of the actual workflow guidance.

**Decision**: SessionStart now injects only compact orientation:

1. compact current state (developer, git summary, active task, journal, spec
   index count)
2. compact `<trellis-workflow>` Phase Index
3. artifact read order and spec index paths
4. current `<task-status>`

Detailed workflow steps, task artifacts, and spec content are loaded on demand
through `/trellis:continue`, `get_context.py --mode phase --step <X.Y>`, skills,
sub-agent context injection, or pull-based preludes.

**Rule**: When adding content to SessionStart, prefer paths and one-action
orientation over inline reference text. Keep the measured total comfortably
below host truncation limits.

---

## Workflow State Injection: Per-Turn Breadcrumb

### Problem

`SessionStart` only fires once per session. In long conversations, Claude's context compression can push the SessionStart message out of recent context, and the AI forgets the active Trellis task — resulting in workflow drift (skips `check`, forgets to `update-spec`, doesn't return to `finish` after user interruptions).

### Solution: `UserPromptSubmit` hook injecting per-turn breadcrumb

A lightweight hook (`shared-hooks/inject-workflow-state.py`) fires on **every user prompt**, emitting a short `<workflow-state>` block reminding the AI of the active task + expected flow. Keep the payload compact and directive; it is injected every turn.

### Skip keyword (`prompt_injection.skip_keyword`, #427)

A user prompt containing the skip keyword (default `no-trellis`) mutes the per-turn
breadcrumb for that turn only — the hook exits 0 with empty stdout before any task
resolution or file reads. Contract:

- Match rule (frozen, identical in Python hook and OpenCode plugin):
  case-insensitive `(?<![\w-])<keyword>(?![\w-])` — `no-trellisfoo`/`foo-no-trellis`
  do not match; `path/no-trellis.md` does (accepted false-positive).
- Config: `.trellis/config.yaml` → `prompt_injection.skip_keyword`
  (ships commented; default in code via `common.config.get_prompt_injection_config()`;
  quoted `""` explicitly disables the hatch).
- Scope: per-turn breadcrumb ONLY. `session-start.py`,
  and `inject-shell-session-context.py` must never gain keyword handling.
- Coverage gap: the Pi extension cannot implement this — it has no `input` handler
  (must not rewrite user text) and its `systemPrompt` must stay byte-identical per
  turn for provider prefix caching.
- Dogfood copies to keep patched region-identically: `.claude/hooks/` and
  `.codex/hooks/` `inject-workflow-state.py`.

### Single Source of Truth: `workflow.md` Tag Blocks

Breadcrumb text lives in `workflow.md` as `[workflow-state:STATUS]...[/workflow-state:STATUS]` blocks (same tag style as existing `[Platform, ...]` blocks). Users who fork the Trellis workflow edit **only the markdown**; the hook script stays untouched.

```markdown
[workflow-state:in_progress]
Flow: trellis-implement → trellis-check → trellis-update-spec → finish
Next required action: inspect conversation history + git status, then execute the next uncompleted step in that sequence.
For agent-capable platforms, do NOT edit code in the main session; dispatch `trellis-implement` for implementation and dispatch `trellis-check` before reporting completion.
[/workflow-state:in_progress]
```

STATUS matches `task.json.status`. Lifecycle values: `planning` / `in_progress` / `completed` / `cancelled`. Marker names may also identify phases or pseudo states; their parser regex `[A-Za-z0-9_-]+` does not add lifecycle statuses.

### Fallback Strategy (hook never crashes)

1. `workflow.md` missing → hardcoded defaults for 3 built-in statuses
2. Tag block missing for a status → same hardcoded default
3. Status unknown (no tag, no default) → generic `"Refer to workflow.md for current step."`
4. No session active task → emit `no_task` pseudo-status breadcrumb instead of silent-exit. Header is `Status: no_task`; body nudges AI to load `trellis-brainstorm` + `task.py create` for multi-step work (or answer directly for trivial asks).

### Design Principle: Per-Turn Hooks Must Not Silent-Exit on "Nothing to Say"

A hook whose job is to **re-ground the AI every turn** should always emit _something_. Silent-exit looks cheaper but defeats the whole purpose — the turn where there's "nothing" is often the most important one (e.g. user switches topics, hops into a fresh subject without an active task).

**Wrong** — hook exits silently when no session active task exists:

```python
task = get_active_task(root)
if task is None:
    return 0  # nothing to inject; goodbye
```

Net effect on a "no task" session: AI sees the Next-Action only at SessionStart; after 20 turns of context compression, the guidance is gone and AI forgets to use `trellis-brainstorm` for new multi-step requests.

**Correct** — treat "no task" as its own pseudo-status with a dedicated breadcrumb template:

```python
task = get_active_task(root)
if task is None:
    breadcrumb = build_breadcrumb(task_id=None, status="no_task", templates=...)
else:
    breadcrumb = build_breadcrumb(*task, templates=...)
```

The same rule applies to every other hook that's positioned as "repeated reminder": if the hook isn't emitting, the reminder loop is broken. The only legitimate silent-exit case is when **the hook doesn't own this codebase at all** (e.g. `.trellis/` not found → definitely not a Trellis project → OK to no-op).

### Platform Support Matrix

| Platform        | Event                                                                                                 | Config File                                                                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code     | `UserPromptSubmit`                                                                                    | `.claude/settings.json`                                                                                            | Shared `inject-workflow-state.py`, distributed via `SHARED_HOOKS_BY_PLATFORM.claude`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Cursor          | ⚠️ Not supported                                                                                      | n/a                                                                                                                | Cursor's `beforeSubmitPrompt` schema accepts only `{continue, user_message}` — no context-injection field exists. Per-turn reminders rely on `sessionStart` only (one-shot at session begin). `inject-workflow-state.py` is not distributed to Cursor; see `SHARED_HOOKS_BY_PLATFORM.cursor` in `shared-hooks/index.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Qoder           | `UserPromptSubmit`                                                                                    | `.qoder/settings.json`                                                                                             | Auto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CodeBuddy       | `UserPromptSubmit`                                                                                    | `.codebuddy/settings.json`                                                                                         | Auto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Droid (Factory) | `UserPromptSubmit`                                                                                    | `.factory/settings.json`                                                                                           | Auto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Gemini CLI      | `UserPromptSubmit`                                                                                    | `.gemini/settings.json`                                                                                            | Auto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Copilot CLI     | `userPromptSubmitted` (camelCase)                                                                     | `.github/copilot/hooks.json`                                                                                       | `bash` + `powershell` dual field                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Codex           | `UserPromptSubmit`                                                                                    | `.codex/hooks.json`                                                                                                | **Requires `features.hooks = true` in user's `~/.codex/config.toml` (Codex 0.129+; legacy: `codex_hooks = true`).** Codex 0.129+ also requires running `/hooks` once to approve the installed hook before it activates — until approved, hooks never fire (the trellis-bootstrap fallback in inject-workflow-state.py covers the gap by directing the AI to read `trellis-start` skill manually)                                                                                                                                                                                                                                                                                                                                                                                        |
| OpenCode        | `chat.message` (Bun plugin)                                                                           | `plugins/inject-workflow-state.js`                                                                                 | Equivalent JS implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Kiro            | CLI: `userPromptSubmit` (main `trellis` agent JSON) · IDE: `promptSubmit` (`.kiro/hooks/*.kiro.hook`) | CLI: `.kiro/agents/trellis.json` `hooks` · IDE: `.kiro/hooks/trellis-workflow-state.kiro.hook` (`then.runCommand`) | Plain stdout (NOT the `hookSpecificOutput` JSON envelope) — Kiro adds a hook's raw stdout to conversation context. `inject-workflow-state.py` has a `platform == "kiro"` branch (detected via `KIRO_PROJECT_DIR` env or `.kiro` script path) that prints the bare breadcrumb. **Activation:** CLI users must make `trellis` the active agent (`kiro-cli settings chat.defaultAgent trellis` or `/agent swap trellis`) — Kiro defaults to built-in `kiro_default`. **Real-machine note:** the plain-stdout→context contract (and whether IDE `runCommand` stdout is injected vs only `askAgent`) is per official docs, pending Kiro hardware verification; fallback is `askAgent` + static steering. Sub-agent context injection unchanged via `agentSpawn → inject-subagent-context.py` |
| Trae IDE        | `UserPromptSubmit`                                                                                    | `.trae/hooks.json`                                                                                                 | Auto; shared Python hook written under `.trae/hooks/inject-workflow-state.py`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ZCode           | `UserPromptSubmit`                                                                                    | `.zcode/config.json`                                                                                               | Shared Python hook under `.zcode/hooks/`. Hook config is read at session start with no hot-reload, so `configureZcode` prints a one-shot "open a new session" notice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Snow CLI        | `onUserMessage`                                                                                       | `.snow/hooks/onUserMessage.json`                                                                                   | Platform-specific `write-trellis-context.py user` (not the shared hook) — Snow is absent from `SHARED_HOOKS_BY_PLATFORM` and bundles its own three inject hooks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Oh My Pi (OMP)  | extension turn hook                                                                                   | `.omp/extensions/trellis/`                                                                                         | TS extension resolves the breadcrumb per turn with its own cache; no Python hook                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Pi              | `before_agent_start` + `context`                                                                      | `.pi/extensions/trellis/index.ts`                                                                                  | TS port; `WF_RE` (`index.ts.txt:1072`) must match the Python `_TAG_RE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Deliberately absent** — these are not gaps to close:

| Platform             | Why                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Cursor               | No context-injection field on `beforeSubmitPrompt` (row above)                                             |
| Grok Build, Kimi Code | `hasHooks: false`. Grok 0.2.x was verified not to consume hook stdout `additionalContext`; both are class-2 pull-based |
| Kilo, Antigravity, Devin | No hook surface and no sub-agents; they get commands + skills only                                     |
| Reasonix             | Skill-only, no hook surface                                                                                |

### CWD Robustness

The hook uses `find_trellis_root()` to walk up from CWD until it finds `.trellis/`, so it works when the terminal is in a subdirectory (monorepo package, etc.) or when sub-agent spawn inherits a drifted CWD.

ZCode hook commands must also make the script path itself CWD-robust. Use the ZCode project-root placeholder in `.zcode/config.json`, for example `{{PYTHON_CMD}} "${ZCODE_PROJECT_DIR}/.zcode/hooks/inject-workflow-state.py"`, rather than `{{PYTHON_CMD}} .zcode/hooks/inject-workflow-state.py`. The Python hook's `find_trellis_root()` only runs after Python opens the script; a cwd-relative command can fail before the hook starts if ZCode launches from a nested directory such as `.github/docs/...`.

### 生命周期、阶段与目录各司其职

四种 task status 表达生命周期；`meta.task_workflow` 通过原生 phase 命令记录有序阶段路线、当前阶段、revision、接受及独立实施授权。workflow.md 是流程和提示正文来源，不能取代阶段事实。阶段完成不等于 task 完成，正式会话交接不构成阶段或状态。

状态目录由 task_layout.py 有界枚举，task_move.py 原子投影；旧平铺与 archive 仅能经显式 migrate-layout 转换。布局不能成为第二份状态事实，也不能从路径推断历史授权。

---

## Bootstrap & Joiner Task Auto-Generation

`trellis init` generates a first-session task based on checkout state. Three branches dispatch off two filesystem flags:

| `.trellis/` exists? | `.trellis/.developer` exists? | Meaning                                                           | Task generated                           |
| ------------------- | ----------------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| no                  | n/a                           | First-time `init` on this project                                 | `00-bootstrap-guidelines` (creator flow) |
| yes                 | no                            | Fresh clone / per-checkout first-init (new machine, new teammate) | `00-join-<slug>` (joiner flow)           |
| yes                 | yes                           | Same dev re-running init                                          | none (no-op)                             |

### Design Decision: `.developer` File Is the Per-Checkout Signal

**Context**: we need a signal for "this checkout has never been init'd by this developer before" to trigger joiner onboarding.

**Options Considered**:

1. `.trellis/workspace/<name>/` directory existence — ❌ this dir is committed to git, so a fresh clone already has it
2. A registry file listing onboarded developers — ❌ needs migration + bookkeeping, over-engineered for single-user checkouts
3. `.trellis/.developer` file existence — ✅ **chosen**

**Decision**: Use `.trellis/.developer` (gitignored) as the per-checkout onboarding signal.

**Why**: `.trellis/.developer` is declared in `.trellis/.gitignore` (template `gitignore.txt`), so it is never committed. A fresh clone has an empty `.developer` slot by construction; the first `init` writes it. Subsequent same-machine re-inits see the file and no-op.

**Consequence (accepted)**: Same developer on two machines (laptop A + laptop B) gets a joiner task on laptop B. This is fine — it's a chance to re-read the spec, and archiving is one command.

**Anti-pattern**: Do not use `.trellis/workspace/<name>/` existence as "this developer already onboarded" — that directory is the journal archive and belongs to git.

### Gotcha: Joiner Dispatch Must Be Wired in Two Places

`trellis init` has two code paths that both reach the end of initialization but through different branches of `init()`. Any new init-time trigger (joiner onboarding, future first-session tasks, etc.) must be registered in **both**:

**Path 1 — Main dispatch** (`src/commands/init.ts`, near the end of `init()`):

- Reached only when `!isFirstInit` is false **OR** `options.force` / `options.skipExisting` is set
- Fires from the block that runs after `createWorkflowStructure` + `init_developer.py`

**Path 2 — Re-init fast path** (`handleReinit`, inside `doAddDeveloper` branch):

- Reached when `.trellis/` already exists AND user runs default `trellis init --user <name>` (no `--force`, no `--skip-existing`)
- `init()` short-circuits via `if (!isFirstInit && !options.force && !options.skipExisting) { await handleReinit(...); return; }` — main dispatch is **never executed**

Both paths must capture the pre-existing `.developer` state **before** running `init_developer.py` (which writes the file), then use that snapshot to decide whether joiner generation applies.

```typescript
// Path 1 (init end) — snapshot at init() start
const hadDeveloperFileAtStart = fs.existsSync(developerFilePath);
// ... later, after init_developer.py:
if (!isFirstInit && !hadDeveloperFileAtStart) {
  createJoinerOnboardingTask(cwd, developerName);
}

// Path 2 (handleReinit) — snapshot just before init_developer.py
const hadDeveloperFileBefore = fs.existsSync(developerFilePath);
execSync(`${pythonCmd} ${initDeveloperScript} "${devName}"`, { ... });
if (!hadDeveloperFileBefore) {
  createJoinerOnboardingTask(cwd, devName);
}
```

**Test coverage requirement**: integration tests must cover BOTH paths. The quick way to detect regressions is to run `init` without `force: true` and assert joiner-task creation — tests that all pass `{ force: true }` will miss Path 2 bugs entirely.

---

## Common Mistakes

### Forgot to add entry to PLATFORM_FUNCTIONS

**Symptom**: `trellis init` configures the platform, but `trellis update` doesn't track its template files — and `getConfiguredPlatforms` never detects the platform, so it is invisible to update entirely.

**Cause**: `collectTemplates` is optional on `PlatformFunctions`, so a registry entry that omits it compiles and fails silently.

**Fix**: Register with `{platform}: fromTemplates(collect{Platform}Templates)` in `src/configurators/index.ts`. That form cannot omit `collectTemplates` — it _is_ `collectTemplates`.

### Missing platform in cli_adapter.py

**Symptom**: Python scripts fail with "Unsupported platform" error.

**Fix**: Add platform to `Platform` literal type, `config_dir_name` property, and `get_cli_adapter()` validation in `cli_adapter.py`.

### Wrong command format in templates

**Symptom**: Slash commands don't work or show wrong format.

**Fix**: Check platform's command format and update all command references in templates.

### Codex template copied from project `.agents/skills` instead of `src/templates`

**Symptom**: Generated templates accidentally include repo-specific customizations and drift from template source-of-truth.

**Fix**: Always use `src/templates/{platform}/...` as source templates for `init/update`. Do not copy from project runtime directories.

### EXCLUDE_PATTERNS missing `.js` in configurator

**Symptom**: In production builds (`dist/`), `trellis init` copies compiled `index.js` (and `.js.map`, `.d.ts`) into the user's config directory (e.g., `.gemini/index.js`).

**Cause**: The configurator walks its template directory and its `EXCLUDE_PATTERNS` doesn't filter out `.js` files. In development (`src/`), only `.ts` files exist so the issue is invisible. In production, `tsc` compiles `index.ts` → `index.js` into `dist/templates/{platform}/` and the walk picks it up.

**Fix**: Ensure `EXCLUDE_PATTERNS` includes `.js`, `.js.map`, `.d.ts`, `.d.ts.map`. Only two configurators walk a directory today and both hold their own list: `claude.ts:22-28` and `opencode.ts:20-29`. Note they differ on purpose — OpenCode ships real `.js` plugin code, so it excludes `.js.map` and `.d.ts` but **not** `.js`.

**Prevention**: Prefer not walking a directory at all. A configurator that enumerates its files explicitly (`cursor.ts`, `droid.ts`, `snow.ts`) cannot pick up a build artifact, which is why it is the default shape. Walk only when the template tree is genuinely open-ended, and then copy the exclusion list from whichever of the two existing walkers matches your case.

### Missing CLI flag or InitOptions field

**Symptom**: `trellis init --{platform}` doesn't work.

**Fix**: Add `--{platform}` option in `src/cli/index.ts` and `{platform}?: boolean` in `InitOptions` in `src/commands/init.ts`. These are static declarations that cannot be derived from the registry.

### Template placeholder not resolved in collectTemplates

**Symptom**: `trellis update` auto-updates platform files on every run, even when nothing changed. The update summary shows hooks/settings as "changed".

**Cause**: `collect{Platform}Templates()` puts a raw template into the map without calling `resolvePlaceholders()`, so `{{PYTHON_CMD}}` survives into the written file and into the update comparison.

**Fix**: Call `resolvePlaceholders()` at the point the entry is added to the map, e.g. `files.set(".cursor/hooks.json", resolvePlaceholders(getHooksConfig()))`. Because the map is now the single description, the placeholder resolves identically on both paths by construction — there is no second site to keep in sync.

Note this is _only_ about `{{…}}` placeholders. The separate `python3` → `python` literal rewrite is applied centrally by `renderTemplateMap` on both paths, so that half of this bug class is structurally closed.

### Init-time settings.json key injection serialized differently from update's preservation

**Symptom**: On a freshly initialized project that used an opt-in feature (e.g., `--with-statusline`), the very first `trellis update` reports `.claude/settings.json` as "Template updated (will auto-update)", rewrites it, and leaves a spurious backup — with zero actual changes.

**Cause**: Init injected the key at a hand-picked position in the template (e.g., `statusLine` "between `env` and `hooks`"), but update's preservation step (`preserveExistingClaudeStatusLine()` in `update.ts`) re-adds preserved keys via plain `parse → assign → stringify`, which appends at the end. The two serializations differ byte-wise, so the content comparison flags a false change.

**Fix**: The init-time injection must mirror the update-time preservation routine byte-for-byte (same parse → assign → stringify, same indent). Pinned by a regression test asserting `settings.json` byte-identity across `update --force` on a fresh opted-in project.

**Rule**: A feature that both (a) injects a key into a generated JSON file at init and (b) preserves that key during update must produce identical serialization on both paths — key order is part of the contract. Assert byte-identity (not deep-equality) in tests; deep-equal comparisons cannot catch key-order drift.

### Template listed in update but not created by init

**Symptom**: `trellis update` always detects a "new file" to add, even on a freshly initialized project with the same version.

**Cause**: `collectTemplateFiles()` in `update.ts` lists a file that `createSpecTemplates()` / `createWorkflowStructure()` in init never creates. The two template lists are out of sync.

**Fix**: Ensure every file listed in `collectTemplateFiles()` is actually created during `init`. If a file is project-specific (not a user template), do not include it in the update template list.

### Project-type-conditional content not gated in init or update

**Symptom**: Pure backend project gets empty frontend spec templates after `trellis init`. After user deletes the unwanted `spec/frontend/` dir, `trellis update` recreates it.

**Cause (init)**: `createSpecTemplates()` in `workflow.ts` received `projectType` but ignored it (parameter named `_projectType`). All project types got both backend and frontend spec dirs.

**Cause (update)**: `collectTemplateFiles()` in `update.ts` unconditionally included all 13 backend + frontend spec files in the template map, without checking whether `spec/backend/` or `spec/frontend/` actually existed on disk.

**Fix (init)**: Use `projectType` to conditionally create spec dirs:

- `"backend"` → guides + backend only
- `"frontend"` → guides + frontend only
- `"fullstack"` / `"unknown"` → guides + both

**Fix (update)**: Wrap backend/frontend spec file blocks in `fs.existsSync()` checks (same pattern as `getConfiguredPlatforms()` for platform dirs).

**Rule**: When init creates content conditionally based on project type, update must check for directory existence before including files in its template map. The two paths must agree.

### PRD assumed platform capabilities without research

**Symptom**: Implementation builds the wrong abstraction (e.g., commands instead of skills, or vice versa). Requires major rework after discovery.

**Cause**: PRD was written based on assumptions about how a platform works (e.g., "Trae uses commands like Kilo") without verifying against official documentation or GitHub repos.

**Fix**: Before writing the PRD for a new platform, research the platform's actual extension mechanism:

- Check official docs for supported formats (skills, commands, rules, workflows)
- Check the platform's GitHub repo for directory structure conventions
- Verify how users invoke extensions (slash command, AI-automatic matching, manual mention)

**Prevention**: Add a "Research" step before PRD finalization. The PRD should cite sources for platform capability claims.

### Updated command/skill content in platform template instead of common/

**Symptom**: After updating a command in one platform's template, other platforms still use old content.

**Cause**: Since v0.5.0, command and skill content lives in `src/templates/common/` as the single source of truth. Editing platform-specific copies creates drift.

**Fix**: Always edit templates in `src/templates/common/commands/` or `src/templates/common/skills/`. All platforms derive their content from there via `resolveCommands()` / `resolveSkills()` / `resolveAllAsSkills()`.

### Stale platform references in copied templates

**Symptom**: A Qoder skill references "Claude Code" syntax or a Kiro-specific invocation pattern.

**Cause**: When creating agent templates for a new platform by copying from an existing one, platform-specific references (command syntax, platform names, invocation instructions) weren't updated.

**Fix**: After copying agent templates, search-and-replace all references to the source platform. Check for:

- Platform name mentions (e.g., "Claude Code", "Kiro")
- Command invocation syntax (e.g., `/trellis:xxx` vs `$skill-name`)
- Config directory references (e.g., `.claude/` vs `.qoder/`)

### Forgot to use shared hooks

**Symptom**: Platform's hooks directory contains duplicated Python scripts instead of the shared ones.

**Cause**: When adding a new agent-capable platform, developer copied hook scripts from another platform's template directory instead of calling `collectSharedHooks(hooksDir, platform)` from `shared.ts`.

**Fix**: Add the platform to `SHARED_HOOKS_BY_PLATFORM` with the hooks it can actually invoke, then use `collectSharedHooks()`. Only create platform-specific hook files when the platform has unique hook integration points (Codex and Copilot each bundle their own `session-start.py` for this reason).

**Prevention**: Declaring the platform in the table is only half the wiring — see "Declaring a shared hook is half the wiring" below.

### Hardcoded JSONL fallback paths

**Symptom**: Agent definitions reference JSONL files that don't exist (e.g., `debug.jsonl`, `plan.jsonl`).

**Cause**: Only `implement.jsonl` and `check.jsonl` exist as task JSONL files. Agent templates were copied from older versions that referenced removed JSONL types.

**Fix**: Ensure agent `.md` definitions only reference `implement.jsonl` and `check.jsonl`. The debug, plan, and dispatch agents have been removed.

### `__pycache__` in template hooks directory causes EISDIR crash

**Symptom**: Tests fail with `EISDIR: illegal operation on a directory, read` in `getAllHooks()` at `src/templates/claude/index.ts`.

**Cause**: Running a Python hook locally (e.g., `python3 session-start.py` for testing) creates `__pycache__/` inside `src/templates/{platform}/hooks/`. `listFiles("hooks")` returns `__pycache__` as an entry, then `readFileSync("hooks/__pycache__")` fails because it's a directory.

**Fix**: `rm -rf src/templates/*/hooks/__pycache__`. Consider adding `__pycache__` to `.gitignore` or filtering directories in `listFiles()`.

**Prevention**: Don't run Python hooks directly from `src/templates/` during development. Use `/tmp` copies or the installed project copy instead.

### Added an init-time trigger but forgot the `handleReinit` fast path

**Symptom**: The trigger works when users pass `--force` / `--skip-existing` / run init on an empty dir, but the default `trellis init --user <name>` on an existing checkout silently does nothing. Integration tests pass.

**Cause**: `init()` at `src/commands/init.ts` early-returns into `handleReinit` when `.trellis/` already exists and neither `--force` nor `--skip-existing` is set. Main dispatch at the end of `init()` is never reached. If the new trigger is only wired into main dispatch, the most common real-user path is uncovered.

**Fix**: Wire the trigger into BOTH (a) the main-dispatch block near the end of `init()` AND (b) `handleReinit`'s `doAddDeveloper` / `doAddPlatforms` branch, whichever is relevant. Capture any pre-init filesystem state (e.g., `.developer` existence) in each path separately, before scripts that mutate it run.

**Prevention**: Integration tests must cover the default path WITHOUT `force: true`. Any test using `force: true` bypasses `handleReinit` and is not testing real-user behavior. See "Bootstrap & Joiner Task Auto-Generation" above for the canonical two-point wiring pattern.

---

## Reference PRs

| PR                            | Platform         | Pattern                                        | Notes                                                                                          |
| ----------------------------- | ---------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| feat/gemini branch            | Gemini CLI       | Agents + shared hooks                          | First non-Markdown command format (TOML settings)                                              |
| main                          | Antigravity      | Workflows + skills from `common/`              | No physical template dir — one `collectBothTemplates()` call; no Codex coupling                |
| #71                           | Qoder            | Skills (like Codex/Kiro)                       | Skills with YAML frontmatter; Trae was dropped (IDE-only, no deterministic invocation trigger) |
| feat/v0.5.0-beta              | All platforms (13 at the time; 21 today) | Unified template architecture | Common templates + shared hooks + `createTemplateReader()` factory                    |
| `04-21-bootstrap-onboard-gap` | n/a              | Three-branch init dispatch + joiner onboarding | `.developer` file as per-checkout signal; documents the `handleReinit` two-point wiring        |

## SessionStart 输入与任务错误投影

共享 Hook、Codex 和 Copilot 的 SessionStart 接受空输入、无效 JSON 和非字符串
`cwd`，以当前目录作为缺省值，沿祖先寻找最近的 `.trellis`。项目不存在或没有原生
active-task 模块时安全返回，不输出伪造的项目上下文。最近的未完成初始化目录不能
借用外层项目。

已绑定任务的 `task.json` 缺失、不可读、不是对象或没有四种合法生命周期状态之一时，
输出 `Status: TASK_ERROR` 与 `status=task_error`；不得回退为可继续实施的未知状态，
也不得自动清除指针或创建替代任务。无任务时交给 request-intake 按当前授权与
taskless 合同路由，不由 Hook 重复要求用户批准已经授权的工作。

`test/scripts/session-start.integration.test.ts` 以真实隔离项目验证三个 writer 的
非项目输入、子目录启动与任务记录错误；平台分发测试仍须共同通过。

## 当前执行模型与退休边界

平台生成链只部署主会话入口、上下文和 Skills。原生三角色、Codex mode/虚拟状态、pull prelude、子身份分片和子执行器均已移除。协作由主会话依合同选择只读 `trellis teamwork` 或实施阶段的 `paseo-based-parallelism`，工具可用性与历史摘要不构成授权。Kiro 主入口和 `.trellis/agents/` 现行协作角色保留。

新增平台或恢复资产不得重建退休接口。升级在原生维护锁内复用备份，先核验旧清单归属、精确内容与指纹；修改、未知归属、skip 和不安全路径在任何删除前阻断。原生快照与 ablation 恢复拒绝重新激活退休执行资产，历史目录仍只作证据。
