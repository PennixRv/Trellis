# Trellis Managed Subnode Assets Design

## 变更边界

当前缺口是 Trellis 只提供 `implement` / `check` Channel role 和项目专属 `parallel-work` 文档，无法让新项目
经 init/update 获得独立证据节点的持久化工件合同。行为实际属于 CLI template collection 与 bundled Channel skill，
而不是 `pennix-skills`、一个新的 runtime service 或项目 workflow。

预计修改：template registry、agent template、两个 Python managed scripts、bundled `trellis-channel` 的 route/reference、
相应 template/script/regression tests、release metadata。明确不修改 Channel runtime 及其 event schema；若该边界内的
重构需要发生，将用现有 Channel tests 证明其行为未变。

## Assets

```text
.trellis/
  agents/subnode.md
  scripts/subnode_artifact.py
  scripts/workspace_note.py
.agents/skills/trellis-channel/
  SKILL.md
  references/subnode-work.md
```

`subnode_artifact.py init` 由 coordinator 在有效 task 下创建：

```text
tasks/<task>/subnodes/<work-id>/<subnode-id>/
  brief.json       coordinator-owned and immutable after dispatch
  worklog.md       assigned subnode appends only
  report.json      assigned subnode's final pending-review result
```

`brief.json` 固定 `schema_version`、`task_id`、`work_id`、`subnode_id`、`role_id`、问题、独立性理由、scope、
protected targets、lens、evidence method、source snapshot、dependencies、stop conditions、deadline、channel reference、
report path、retry/counter relation。helper 以 task root 解析 containment，拒绝 traversal、symlink、重复初始化和 identity
冲突；不把 `source_snapshot` 解释为读路径白名单。

`validate` 只接受报告的产物状态 `complete|blocked|incomplete|error`。`complete` 需要可复查 evidence，所有状态需与
brief identity/digest/scope/lens 一致。报告永远是待核验工件；主协调器 task disposition 才可记录
`accepted|rejected|deferred` 与 `report_validation` / `source_recheck` / `protected_target_check` / optional
`counter_comparison`。

`workspace_note.py` 解析 developer identity，安全/原子地向 `workspace/<developer>/working-notes.md` 追加 UTC、kind、
bounded summary 和 optional source locator。它不以 task 或 Channel 为输入，也不调用 `add_session.py`。

`workspace_note.py` 的正常写入会新增或修改 `working-notes.md`，因此验收中的 Git 边界是“不调用 Git 或改变 Git
历史”，不是错误地要求工作树状态保持不变。它同样不得改变 task、journal 或 workspace index。

## Channel Reference

`trellis-channel` 只在用户明确需要一项有独立证据价值的分析/设计/审计/审查/反证/验证时路由至 `subnode`。它要求
一个冻结 brief、稳定 report path、原生 Channel create/spawn/send/wait 和主协调器的独立核验。终端消息是短状态与
路径提示，不运输 JSON 报告。

工具面存在 live continuation 时必须先建立且只续接同一个 waiter；纯 CLI 按 documented send 后单次 native wait。
reference 不虚构一段同时适用于两类表面的 shell pre-wait，也不引入 polling/second waiter。写入约束是 role/brief/
helper/coordinator checks 组成的行为合同，而非 sandbox 安全承诺，因此不会传递 `--sandbox`。

## Compatibility And Rollback

这些新增 managed assets 通过现有 template hash 与 `.new` conflict 机制分发。未选择 marketplace workflow 的项目
仍保持原有 inline/default workflow。发布前可撤销新增文件和 registry entries；发布后出现问题以新 release / `.new`
审阅修复，不能在用户项目或用户 Skill 恢复兼容 wrapper。

## Codex Default

Trellis fork 的 Codex default 是 inline。`codex.dispatch_mode: auto` 或 legacy `sub-agent` 是显式 opt-in，保留原生
agent 兼容性。这个值必须在 task manifest seeding、phase routing 和 Codex hook breadcrumb/mode banner 一致；只改
workflow prose 不能改变 task lifecycle 的实际 JSONL gate。
