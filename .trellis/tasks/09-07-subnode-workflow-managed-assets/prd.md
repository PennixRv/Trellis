# 实现 Trellis 受管理 subnode 工作流资产

## 目标

实现并发布已批准架构中的 Trellis 通用资产，使 `trellis init` / `trellis update` 能向 Codex 项目交付
受管理的 `subnode` role、subnode 工件校验脚本、主协调器轻量工作记录脚本和项目中立的 Channel 使用说明。

## 要求

- 新增 `.trellis/agents/subnode.md`，其行为合同是：业务/审查目标和权威 task/Issue 只读；只在 coordinator
  分配的专属 task 目录写 `worklog.md` 与 `report.json`；禁止实施、Git、再分派、生命周期控制和事实晋升。
- 新增受管理的 `subnode_artifact.py`，提供 `init`、`validate`、`validate-counter`。它必须校验 task containment、
  identity、brief digest、报告边界、大小、明显 secret、状态和关联，但不裁决技术结论、运行 worker 或解析终端消息。
- `report.json.status` 仅接受 `complete`、`blocked`、`incomplete`、`error`；`complete` 仅表示节点产物完成，
  禁止将 `accepted`、`rejected`、`done` 等项目验收语义写入报告。
- 新增 `workspace_note.py`，将受限 note 原子追加到 developer workspace 的 `working-notes.md`，不创建/读取 task，
  不触碰 journal、index、Git、Channel 或 prompt 注入。
- 将 bundled `trellis-channel` 从根仓库专属的 `parallel-work`、terminal wrapper、历史命名和 `--sandbox read-only`
  示例中迁出，新增按需 `subnode-work.md`；Channel 仍是 worker lifecycle/event audit 的唯一控制面。
- 维持普通 inline 工作默认；不新增自动 retry、轮询、第二 watcher、全局 ledger、worktree、dashboard、provider
  特判或 Codex native agent。
- 与 Pennix marketplace workflow、真实 Codex host 验收和用户级 Skill 清理保持有序依赖；本 task 不假称它们已完成。

## 非目标

- 不修改 Channel event schema、spawn/wait/interrupt/cleanup 实现、provider adapter、worker guard 或
  `TEMPLATE_INDEX_URL`。为恢复已批准的 inline 默认而收敛 config、workflow、Hook breadcrumb 与 task
  manifest seeding 属于本 task；不新增或扩展 native Codex dispatch。
- 不创建 marketplace fork、不执行真实 provider worker、不修改用户安装副本；发布后的根仓库 adoption 与
  `pennix-skills` 清理由各自 task 负责。

## 验收标准

- [ ] init/update 的 managed template registry 能生成并安全更新 role、两个脚本和 bundled Skill reference。
- [ ] helper 的单元/CLI 测试覆盖 containment、符号链接、重复 init、schema/identity/digest、大小/secret、
  status、correction、retry、counter 和 workspace note 的非侵入边界。
- [ ] bundled Channel 文档不再引用 `parallel-work`、终端 JSON transport 或 `--sandbox read-only`，并对 live
  continuation 与纯 CLI wait 明确分支。
- [ ] 当前 Channel、template、workflow 与 TypeScript/Python 测试继续通过，且 GitNexus impact/detect-changes
  或可用的本地等价检查已记录。
- [ ] 以当前官方资料、源码、测试和 release preflight 核验后完成一个可追溯的新 Trellis release；未验证的
  Codex host 行为保持 deferred。

## 证据与约束

- 总体架构：`codex-workflow-optimization/.trellis/tasks/09-07-trellis-reusable-concurrent-workflow-architecture/`。
- 参考输入与外部模式：`codex-workflow-optimization/docs/trellis-concurrent-workflow-reference-input.md`。
- 用户已明确批准本 task 的实现、普通本地提交、远程推送和发布；高影响行为仍仅限本 PRD 的资产和验收范围。
