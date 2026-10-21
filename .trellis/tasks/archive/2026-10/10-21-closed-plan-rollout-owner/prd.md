# 落地闭合方案工作流：更新预览修复、Marketplace 与项目资产

## 目标（Goal）

执行根 rollout 已批准的 Trellis owner 步骤：修复 dry-run 写入、恢复唯一嵌套 Marketplace，发布 beta 并更新本项目资产；保留无关 subnode 任务。

## 需求（Requirements）

- Follow the already displayed and approved root rollout plan, revision 3, at `../.trellis/tasks/10-21-closed-plan-workflow-rollout/`. This owner task records its Trellis steps; it introduces no new product decision.
- Work only on `pennix/v0.7-beta`. Keep the unrelated `09-07-subnode-workflow-managed-assets` task open.
- Make `update --dry-run` preserve the hash-manifest bytes even when orphan keys exist; retain in-memory pruning and normal-update persistence.
- Restore Marketplace as the sole `marketplace` nested submodule, fixed to published Marketplace `main`; keep docs-site and current package/CI checkout boundaries.
- Use the native beta release flow, then the Lifecycle-installed CLI to preview and update this project's managed assets. Preserve custom files and the selected workflow contract.

## 验收标准（Acceptance Criteria）

- [ ] Regression reproduces the orphan-manifest dry-run write and passes with the minimum fix; CLI lint, typecheck, tests, build and release preflight pass.
- [ ] Marketplace URL/branch/gitlink/checkout match the verified published source; recursive clone and package exclusion pass.
- [ ] Native release publishes matching CLI/core beta artifacts from this branch; source, remote and npm evidence agree.
- [ ] Installed CLI updates this project's assets after reviewed dry-run; native workflow verification passes, custom content and unrelated task remain intact.
- [ ] Work and native task archive commits are pushed to `origin/pennix/v0.7-beta`; root records the final owner HEAD and cross-layer acceptance.

## Authorization and boundaries

The user approved the complete rollout and explicitly instructed deterministic completion without another approval. The root plan already specifies the owner, files, release, topology, checks and stop point. This task is its local execution record. No new runtime dependency, Lifecycle source/catalog change, Marketplace content change or npm package expansion is included.

<!-- trellis-decisions:v1 -->
```json
{"schema_version":1,"decisions":[{"id":"D1","status":"decided","question":"Which source, topology and delivery contract does this owner execute?","evidence":["Approved root rollout revision 3 PRD D1/D2/D4 and implement steps fix-trellis-dry-run through materialize-trellis-project","User explicitly instructed deterministic completion without another approval"],"answer_or_reason":"Use pennix/v0.7-beta, minimum dry-run persistence fix, sole nested Marketplace main checkout, native beta release and Lifecycle-installed CLI project update.","impact":"Only the already approved Trellis steps and their validation are owned here; root retains cross-layer and host acceptance.","reopen_when":"The implementation requires changing an approved owner, public contract, release behavior, acceptance or rollback."}]}
```
<!-- /trellis-decisions:v1 -->
