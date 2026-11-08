# Minimum phase-method correction and beta release

Modify `packages/cli/src/templates/common/bundled-skills/trellis-decision-space-construction-and-merging/workflow.md` to challenge material defaults and identify unknowns before handoff. Modify the neighboring solution-design workflow to reassess after answers, evidence and revisions and loop review findings back to decision discovery. Keep the existing stage and authorization semantics; stop when material unknowns have a disposition rather than requiring fixed question counts.

One source/release work package covers both prose and diagrams, the next beta migration manifest, and bilingual docs-site release notes/navigation. Docs-site stays on `codex/chinese-user-templates`; Trellis stays on `v0.7.1`. Push docs first, then publish `v0.7.2-beta.4` through existing CI. No local npm publish. Root coordinates Lifecycle exact-version reinstall and native project materialization, then pins the verified final component commit.

## 验收覆盖

| 接受条件 | 工作包 | Owner | 验证入口 | 交付证据 | 停止条件 |
| --- | --- | --- | --- | --- | --- |
| Material default discovery and re-evaluation are explicit and bounded | Phase methods and beta release | Trellis | Prose/diagram review and existing template tests | Source diff and execution.md | Stop on required protocol or unrelated component changes |
| Released artifacts contain the source methods and paired versions | Phase methods and beta release | Trellis and docs-site | Build, pack dry-run, fresh init/update smoke, native release gates and CI/npm checks | Tag, CI run, paired npm identity | Do not install inconsistent or unpublished artifacts |
| Reinstall and project assets consume the release, component Git is clean | Phase methods and beta release | Lifecycle installation; Trellis generation; root coordination | Native update, status/check, template comparison and git status | Root execution evidence and component closeout | Stop on unresolved ownership or modified-template conflicts |

Required release checks remain required; no new complex test suite or real-model evaluation is introduced. Root `.codex/config.toml` disables native agents, so the main session implements and checks directly. GitNexus file impact is UNKNOWN on a stale index; bounded current source/test references resolve the actual template distribution path instead of treating zero graph edges as safety evidence. Preserve unrelated content and runtime data. On failure inspect actual release/install state and resume the native owner flow; previous source and installed beta.3 are recovery baselines.
