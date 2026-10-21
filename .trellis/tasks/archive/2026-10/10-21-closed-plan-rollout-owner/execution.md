# Execution record

## Approved root decomposition

This task records the Trellis steps already approved in root rollout revision 3. The user explicitly instructed deterministic completion without another approval. Native create, planning progression, digest, seal, approval and start succeeded at revision 1, digest `sha256:103b09972ea089f29e7a3d48571ac1cfc43de1d83c41854654f6de390c1dfdf9`. No task state was hand-written. The initial context validation rejected empty lists, then rejected the oversized update spec; curated release and integration-test specs now pass validation, while the main session reads update guidance directly. No subagent is dispatched.

## Dry-run regression

CodeGraph returned current source and relationships for `pruneOrphanManifestKeys`: update, uninstall and ablate callers share the existing optional persistence flag. Its nearest root index also includes sibling repositories; only the Trellis paths are relevant here. GitNexus native tool/runner is unavailable in the inspected host/checkout, so its mandatory graph checks are `not_run`; CodeGraph and current source provide the bounded impact evidence under AGENTS.md's capability precondition. No index initialization or sync was performed.

The existing #2 integration test now seeds an orphan `.codex/sessions/user-session.jsonl` hash and compares complete manifest bytes. Before the fix it fails at that assertion, proving update preview pruned and wrote the file. The one-line fix passes `persist: !options.dryRun` at update's shared prune call; normal-update and other callers' defaults are preserved. The update spec now records this pre-return mutation trap.

## Source gates and release preparation

- Update integration: 68/68 passed. Root `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm release:check` all exited zero. `release-preflight verify-packed-cli` confirmed an exact core dependency. The npm 12 dry-run pack result is keyed by package name; inspecting its actual shape confirmed the planning template at `dist/templates/common/skills/idea-to-closed-plan.md` and no Marketplace paths. A fresh temporary Git project's native Codex init materialized and hash-tracked `trellis-idea-to-closed-plan`; subsequent native update preview reported already up to date. Temporary fixtures were removed.
- Marketplace `main` was pushed first; nested `marketplace` declaration, gitlink, checkout HEAD and `origin/main` all match `8ed33cbc701a23453b2d9f5d2c5e648383fdf2a5`. Root has removed its direct checkout and updated the integration topology checks with real Git fixtures. No Marketplace contents or CI/npm checkout scope changed.
- Next release is beta.53; its existing migration manifest preserves hash-guarded removal of 18 retired planning Skill files and all prior manifests. Native docs guard passes after matching English/Chinese changelogs and navigation updates. Docs source stays on its existing published `codex/chinese-user-templates` maintenance branch; companion commit `fcd13089429a44a0f44285012cf8ba42a497cc73` is pushed to that same upstream. No docs branch merge or unrelated task is included.
- Source publication, real recursive clone, native beta release, Lifecycle installation and this project's materialization are still pending. A passed static/source gate is not the rollout stop point.

## No-op dry-run version-stamp regression

During the six-project beta.53 preview, the no-file-change upgrade fast path wrote `.trellis/.version` despite `dryRun`. Root and Trellis markers were restored from the exact pre-update Git baseline; no project materialization began. CodeGraph source evidence traced the write to the unguarded `updateVersionFile()` call in `update()`'s early-return branch. This remains within the approved update dry-run fix: guard that write and add an integration regression proving a version-only preview preserves both `.version` and `.template-hashes.json`; then rerun the applicable source gates and publish the next beta before retrying previews.

## beta.53 Lifecycle installation and regression verification

npm beta.53 visibility recovered and both CLI/core package artifacts were verified. Lifecycle updated only `trellis-cli` to beta.53; `components.lock.json` and `pennix status/check` report the matching version, while SiYuan remains `current`. The exact native component receipt still belongs in the final integrity audit. The added no-op dry-run guard and regression now pass update integration 69/69, lint, typecheck, full tests (2,315 passed, 2 skipped), build and `release:check`. Running the built local CLI against root and Trellis at beta.52 confirms their version markers, template hashes and Git status remain byte-for-byte unchanged during the preview. Beta.54 must carry this follow-up before project materialization resumes.

## beta.54 release visibility checkpoint

The beta.54 tag and local/remote `pennix/v0.7-beta` all resolve to `3f9247e8bc611ce19103ac220cf07bf97f07b4bb`; docs-site local and remote maintenance branch both resolve to `aae956ee68dc6930bef802e0a1f74d91f18dc210`. Actions run `39623236399` passed version alignment, typecheck, build, full tests, packed dependency verification and core publication. CLI publication completed, and the workflow is still in its public npm verification step. `@pennixrv/trellis-core@0.7.0-beta.54` is visible with integrity `sha512-AxV+e16rOIOtwHC0j15ozuyyYIPG78dH8Naxl+ZC88yBt4otCFjYn1YBj9lICmwF5/KedPmA5YFYgEljLGq8rg==` and shasum `eda7c9783ae8e3a409aada0ee8b0533fd72bec9b`; the CLI version still returned npm E404 at this checkpoint. No republish, Lifecycle update or project dry-run has started. Current Lifecycle status/check still report Trellis beta.53 and SiYuan MCP `current`.

## 2026-10-22 最终 rollout 与消费者验收

- beta.54 发布闭环完成：Trellis `pennix/v0.7-beta`、`origin/pennix/v0.7-beta` 与 `v0.7.0-beta.54` 均为 `3f9247e8bc611ce19103ac220cf07bf97f07b4bb`；docs-site 维护分支本地与远端均为 `aae956ee68dc6930bef802e0a1f74d91f18dc210`；Marketplace 独立 `main`、`origin/main`、Trellis 嵌套 gitlink 与 checkout 均为 `8ed33cbc701a23453b2d9f5d2c5e648383fdfda5`。
- Lifecycle 原生更新已完成且复核通过：`trellis-cli` 为 `0.7.0-beta.54`，安装 SHA-256 为 `ad8b2de5b3b4739de547365d830fcef45420a34174d1601c1877a1b35073ca34`；`pennix-skills` receipt/lock/source ref 均为 `088caf16cfd6ff4e20fe08adbb1d503f9d715642`，lock SHA-256 为 `8bc429f3043fc86738d534f9c58839d759c7af42502e87b39684c892e567bfd0`。原生 `pennix status --json` 与 `pennix check --json` 均为 match，SiYuan selected 且 `mcp_state=current`。
- 六个 Trellis 项目均先通过 beta.54 原生 `trellis update --dry-run`（退出 0，未写版本、模板哈希或 Git 状态），再完成原生物化与 workflow verify；root 离线集成检查 `11/11`、Node 集成检查 `7/7` 通过。四个项目物化任务已由各自原生 CLI 归档，最终 owner HEAD 与对应 `origin/main` 对齐：Skills `1eeb623b1ffe4537ade6a8c83859e7b0f6ac3495`、CCH `a03627402706d1329ade8dd9fc5fbdec85e7499a`、CodeGraph `f5addf228cd8743e71ab5e7811cff19a6c6381e5`、Windsurf `3acd0c0c79c1c39ba77324b7e841463a790e7bbb`。
- Windsurf 源任务已先由原生 CLI 归档并推送，最终 `origin/main` 为 `7bae3be428573bcca7f05d3aeb14ee81d1552e5c`；随后 Skills collection 仅更新该已归档 SHA，生成物字节无变化，Skills 两个 owner 任务原生归档并推送，最终 Skills `origin/main` 为 `088caf16cfd6ff4e20fe08adbb1d503f9d715642`。未修改安装目录、receipt、lock 或配置。
- 最终真实新 Codex 宿主线程 `01a15f7d-a222-77c0-9c32-a2bfb894c3d9` 在只读边界内读取项目规则、工作流、项目规划 Skills 和实际安装的三个全局路由 Skills；实际执行 `SessionStart` 与 `UserPromptSubmit` Hook，并核对最终 receipt/lock ref。A–D 场景全部 `PASS`：新跨组件请求走完整规划链；重大变化 native replan 并使旧批准失效；小修订保持状态/阶段并写 `execution.md`；非法 archive/跨阶段被拒绝。未执行任何 archive/replan/advance 或写入操作；该消费者证据完成最终 Skills 更新后的行为验收。
