# Continuation Record 实施清单

只在 task 从 `planning` 正式进入 `in_progress` 后执行；Codex inline 主会话直接实施和检查。

1. 读取本 task、适用 specs、`AGENTS.md`；用正确 GitNexus CLI 运行 `status`，对 `task.py`、
   `session_context.py`、`index.ts`、新增 CR 符号执行 `impact`。`risk UNKNOWN` 未收敛前停止编辑。
2. 先修复 `common/active_task.py` 的 session isolation 根因：仅在没有 `context_key` 时允许
   `_resolve_single_session_fallback()`；已知 key 缺少/为空 pointer 时返回 `none`。同时补
   Python/TypeScript resolver 与 `.codex/hooks/inject-workflow-state.py` 的回归，证明旧
   foreign task 不会被注入，且无 identity 的既有 fallback 不回归。
3. 复用 `active_task`、`task_store`、`paths`、`io`、`git` 建立集中 CR decoder/source snapshot/CAS/atomic
   writer；实现 `continuity status/seal/clear`，不改变现有 task command 的语义。
4. 只读接入 session context；同步 dogfood/template 并在 `index.ts` 注册新 script。若需 workflow-state
   展示，只追加状态且同步 workflow contract。
5. 补最小充分回归：正常创建/读取、无 task、CAS mismatch、source drift、损坏/半写、secret/path/symlink、
   clear 精确性、context JSON/text、fresh init/update、旧 task lifecycle 不受影响。
6. 运行 lint/type-check/tests、`trellis-check`、template/dogfood compare；提交前 `git diff --check` 与
   GitNexus `detect-changes`。失败时修根因或停下，不发布。
7. 通过后按仓库正式 release 脚本发布配对 CLI/core 版本、推送 tag；回写根仓库固定 commit/tag/版本。
   宿主重装与 `/home/penn/.codex` 文档更新由最终集成阶段执行。

## Stop conditions

- CAS/source/path/secret 任何保护失败；template 不同步；task state 被 CR 改写；GitNexus UNKNOWN；或测试
  未通过：保留旧 release，不提交/发布，不删除 runtime 或业务数据。
