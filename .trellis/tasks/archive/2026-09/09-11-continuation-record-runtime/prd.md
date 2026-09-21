# Implement task-bound Continuation Record runtime

## Goal

实现 task-bound Continuation Record（CR）：它是 Trellis task、当前 Git 和显式 evidence 的受控
运行时投影，为跨会话连续性提供 source-digest、CAS、原子写入和 fail-closed 的只读状态。它不构成
第二 task ledger，不接管正式 handoff，也不接管 OpenViking、Codex Plugin、`context-mode` 或 FastCtx。

## Requirements

### R1. 职责与输入边界

- CR 的唯一所有者是 Trellis。输入只包括当前 session-scoped active task、当前 Git 状态和显式
  project-relative evidence；不得接受 OpenViking recall、Plugin private state、完整 transcript、模型
  推断、远端 Task 结果或任意其他 session 的 pointer。
- active-task resolver 必须遵守 session isolation：当 `context_key` 已成功解析但当前 key 的
  session 文件缺失、损坏或没有 `current_task` 时，必须返回无当前 task；single-session fallback
  只允许在 `context_key` 不存在时使用。当前 key 不得借用唯一的 foreign session pointer。
- `source=session-fallback:<key>` 是无 identity 的兼容性降级来源，不是当前正式 handoff target
  的直接绑定证明；handoff consumer 需要拒绝把它当作 target session 已绑定。
- CR 不得改写 task status、session pointer、task archive、正式 handoff core 或 OpenViking 状态。
- `pennix-session-handoff` 只能经稳定 CLI/JSON 读取 CR 投影，不能 import Trellis Python；Trellis
  不能 import `pennix-skills` 或调用 MCP/HTTP/Plugin。

### R2. 记录合同与来源新鲜度

- 记录必须有固定 `schema_version`/`kind`、task identity/material digest、Git/evidence source digest、
  revision、更新时间、record digest，以及有限的 objective、decision、completed/open items、blocker、
  next safe action 和 non-transferable operation 摘要。
- `source_digest` 覆盖 task material digest、Git branch/HEAD/worktree/dirty-path digest 和 evidence
  digest；每次读取重新计算。任何差异必须为 `stale`，不能显示为可继续的事实。
- 所有文本、列表、evidence、总记录和单字段都有固定上限并检测敏感内容；不得保存凭据、PID、wait
  handle、工具句柄、原始 tool I/O、完整 rollout/transcript 或 OpenViking archive 内容。

### R3. 写入、CAS、路径与原子性

- CR 只能由显式 task CLI gate 写入；不得被 `SessionStart`、prompt、compact、`get_context`、
  workflow hook 或 OpenViking Hook 自动创建/覆盖。
- 更新必须带 `expected_record_digest`（首次创建明确期待 absent）和当前 active task。CAS 不匹配、
  源漂移、非法 schema、非普通文件、symlink、越界路径或不安全输入均拒绝写入且保留旧记录。
- 使用 `.trellis/.runtime` 内由 task identity 派生的固定目录、临时文件、受限权限、flush 与 atomic
  replace。崩溃、并发、半写、权限错误或损坏记录不得损坏现有 task/handoff 或产生可用假象。

### R4. 只读投影与模板传播

- 新增 `task.py continuity status --json` 和显式 seal/clear 操作（参数在设计中冻结）；`get_context.py`
  和 `$trellis-start` 仅显示 `absent|ready|stale|withheld` 与有界摘要，不写入、修复、清理或执行
  `next_safe_action`。
- 无 active task 时必须为 `absent`，不得按最近修改时间、全局 CR 或其他 session 推断。
- `task.py start/finish/archive` 语义保持不变。新脚本必须注册至 `index.ts` 的 export 与
  `getAllScripts()`，同步 dogfood/template，并在 fresh `trellis init` 与 `trellis update` 验证。

### R5. 本轮迁移边界

- CR 是未来替代 RecoveryBrief 记忆职责的候选，但本 task 不删除、桥接或改写 context-mode；FastCtx
  的 cutover/退役另立任务。
- CR 不镜像 OpenViking archive/memory/resource/skill/watch，不把其异步状态升级成 Trellis 事实。

## Acceptance Criteria

- [ ] 对 schema/kind/digest、task/evidence/Git source、大小/secret/path 限制、CAS、原子写、无 task、
  source drift、损坏/半写记录和并发写入有自动化测试；不安全条件 fail closed。
- [ ] active-task resolver 与 workflow hook 覆盖：已知当前 key 无 pointer + 唯一旧 pointer 时返回
  `none`；已知 key 的空/损坏 pointer 不 fallback；无 key 时保留既有 single-session fallback；
  exact current pointer 仍优先。handoff target 不得通过 `session-fallback` 完成绑定。
- [ ] `task.py continuity`、`get_context.py`、workflow state 和 handoff consumer 只获得有界只读
  projection；不会改 task status、执行 pending action、读写 OpenViking 或 context-mode。
- [ ] template/dogfood 脚本完全一致；新模块已被 `index.ts` 注册；fresh init 和 update 均能得到正确
  脚本且不绕过已有 hash/conflict 保护。
- [ ] 现有 task/context/channel/workflow-state 回归、lint/type-check/test、`trellis-check` 和
  GitNexus 提交前 `detect-changes` 均通过；未通过的 OpenViking convergence 能力仍明确为
  `management_observable`。
- [ ] 发布后提交、tag、版本、测试结果和回滚版本已交给根仓库集成验收；本 task 不直接安装到
  `/home/penn/.codex`。

## Out Of Scope

- OpenViking/NAS/Plugin/MCP/CLI/远端数据或服务的修改、写入和删除。
- 正式 handoff core/lifecycle receipt/finalizer/retention 的实现；它们属于 `pennix-skills`。
- `context-mode` 退役、RecoveryBrief bridge、FastCtx 切换、lease/scheduler/daemon/database/外部依赖。

## Notes

- 这是复杂 task；`design.md` 和 `implement.md` 是激活前必需工件。当前 task 仍是 `planning`；不能以
  本文档完成冒充实现已开始。
