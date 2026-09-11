# Continuation Record 技术设计

## Boundary

CR 是 derived runtime projection，不是事实源。唯一数据流为：

```text
session-scoped active task + task artifacts + Git + explicit evidence
  -> source digest + bounded CR -> read-only status/projection
  -> get_context / formal-handoff consumer
```

读取方必须重新核验 source；CR `ready` 不授权实施、不证明 handoff core ready，更不证明
OpenViking archive/extraction 收敛。

## Session identity and active-task isolation

`active_task.resolve_active_task()` 的 fallback 边界是交接安全前提：

```text
known context key
  -> read only that key's session file
  -> exact task: session:<key>
  -> absent/empty/invalid: no task, no fallback

no context key
  -> optional single-session fallback
  -> session-fallback:<sole-key>
```

已知当前 key 但缺少自己的 pointer，不能因为运行时恰好只有一个旧 session 文件就继承旧
task。这样既保留无 identity 的 class-2 sub-agent 兼容，也阻止 formal handoff target
重新读到 source task。`task.py current --json` 与 workflow hook 必须保留来源标记，consumer
只能把 `session:<target-key>` 视为直接绑定。

正式 handoff 的初始接管仍然只做 validate、prompt 阅读和 `$trellis-start` reconciliation，
不自动 start。用户随后明确授权继续时，必须在当前 target identity 下调用原生 `task.py start`
（未完成 task）并复读 `current --json` 验证直接来源；已完成 task 不应为了绑定而 start，直接
按精确 task path 走正常 finish/archive。两条路径都不能靠修改 task JSON 或删除 foreign pointer
完成绑定。

## Storage and schema

运行态路径固定为 `.trellis/.runtime/continuation-records/<safe-task-id>/record.json`。`safe-task-id`
来自已解析的 current task，拒绝路径输入、`..`、绝对路径及 symlink。记录使用单一 decoder：

```json
{
  "schema_version": 1,
  "kind": "trellis-continuation-record",
  "task": {"id": "...", "path": ".trellis/tasks/...", "status": "in_progress", "material_digest": "sha256:..."},
  "source": {"git": {"branch": "...", "head": "...", "worktree_state": "clean|dirty", "dirty_paths_digest": "sha256:..."}, "evidence": [{"path": "...", "bytes": 1, "sha256": "sha256:..."}], "source_digest": "sha256:..."},
  "content": {"objective": "...", "decisions": [], "completed": [], "open_items": [], "blockers": [], "next_safe_action": "...", "non_transferable_operations": []},
  "revision": 1,
  "updated_at": "...",
  "integrity": {"record_digest": "sha256:..."}
}
```

`record_digest` 是 canonical payload（自身字段除外）的 SHA-256。文本/列表/record/evidence 上限和
秘密拒绝逻辑集中在该 decoder；不得让 CLI、context 与 handoff 分别解析内容。

## Derived states and CAS

| 状态 | 条件 | 投影 |
| --- | --- | --- |
| `absent` | 当前 task 无 CR | 仅显示缺失 |
| `ready` | 结构、record digest、task identity、source digest 全部匹配 | 显示有限内容 |
| `stale` | CR 合法但 task/Git/evidence 任一漂移 | 显示陈旧，禁止作为动作依据 |
| `withheld` | schema/path/secret/permissions/JSON/digest 无效 | 仅显示 reason code |

`seal`：读取 current record，验证 explicit expected digest（首写为 `absent`），重新算 source，验证
bounded request，创建 temp 同目录文件，`flush/fsync`、权限收紧、`os.replace`。失败不覆盖旧文件。
`clear` 同样要求 expected digest，且只精确删除当前 CR。可使用现有 `common.io`/`paths`/`active_task`/
`git` helper 和标准库；不增加进程服务或数据库。

## CLI and context integration

在 `task.py` 增加 `continuity` namespace：

- `status [--json]`：获取当前 task 的派生状态与有限 projection；
- `seal --request <project-relative-json> --expected absent|<digest> --explicit-user-request`；
- `clear --expected <digest> --explicit-user-request`。

返回包含 `operation`、`status`、task identity、revision/source/record digest（可用时）和有限 reason code。
`session_context.py` 仅调用 shared reader。必要时 workflow hook 显示状态，但绝不在 hook 中写 CR。
保留现有 task lifecycle 和 per-session pointer 行为，并修复 resolver 在“已知 key 无 pointer”
时错误进入 single-session fallback 的行为。

## Template and consumer compatibility

添加 common module 后同步：template module、dogfood `.trellis/scripts/`、`index.ts` export/map、task parser、
session context 与 regression fixture。`trellis update` 继续走 hash/conflict 机制。Pennix consumer 只可运行
`task.py continuity status --json`；无 CR 或 stale 都安全退化，不触发 remote 行为。

## Rollback

旧 Trellis 版本忽略 CR runtime 文件，故升级失败可以通过原生 release/install 回退；不删除 task、handoff、
rollout、OpenViking 数据或 `.runtime` 历史文件。旧 schema 返回 `withheld`，不自动迁移或覆盖。
