# 开发工作流（Development Workflow）

---

## 核心原则（Core Principles）

1. **先规划再编码**——开始前先明确要做什么。
2. **注入规范而不是凭记忆遵守**——指南通过 Hook/Skill 注入，而不是从记忆中调用。
3. **全部持久化**——研究、决策和经验都写入文件；对话会压缩，文件不会。
4. **增量开发**——一次推进一个任务。
5. **记录经验**——每个任务完成后复盘，并将新知识写回 spec。

---

### 继续与压缩恢复（Continuation and Compaction）

根目录、任务、阶段、授权和待执行动作已知时，复用当前对话或足够的压缩检查点。普通继续直接恢复该动作，不重复启动、任务/Git/历史或交接核验。新会话、目标变化或用户明确要求检查时，只查询缺失或冲突事实。原生受保护写入保留 owner 身份和所有权检查。不要重复或重答压缩前已经消费的用户输入；真正的新输入按正常流程处理。不增加恢复缓存或额外等待器。

## 方案批准与任务选择（Plan Approval And Task Selection）

显式将任务元数据分类为 `execution_class=direct|planned` 和 `delivery_mode=change_bearing|analysis_only`；未分类的旧 planning 任务需在 start 前补一次分类。直接小任务和符合条件的 analysis-only 任务保留现有最短路径。已有 in_progress 任务不重置。

除边界清晰的研究外，使用 `pennix-decision-grill` 筛选涉及用户实质取舍的选择；一个实质选择即可触发。它负责渐进提问方法，不负责任务生命周期。先处理依赖已满足且有证据支撑的选择，再处理影响和优先级；一次询问一至三个相互独立且连贯的决策，回答后重新评估。不要询问可直接查明的事实或已经确定的实现细节。在执行有界本地/网络证据工作或明确批准独立子节点前保存决策检查点。可执行前沿为空可能表示缺少证据，不表示方案已封口。

对于 planned/change-bearing 工作，先收敛决策和必要任务资产，展示最终方案的目标、范围、修改目标与负责组件、关键决定、验收与验证、风险、发布/安装、回退及完成点，再按 `pennix-decision-grill` 的宿主交互合同征询“封口并批准推进”或“补充／修改方案”。明确合并授权后，才依次运行原生 `task.py plan seal <task> --expected-digest <digest>`、使用实际 revision 的 `task.py plan approve <task> --revision <n> --basis "<简短且不含敏感信息的实际批准依据>"`、`task.py start`。授权只覆盖同一任务刚展示的方案，不重复索取同一实施批准。最初的交付请求、父任务批准和普通设计答复都不构成实施批准。`--allow-empty-context` 只覆盖上下文清单，不覆盖批准门禁。原生记录负责结构约束，对话真实性仍由 Agent 负责。

补充意见保持 planning，更新方案后重新展示确认；用户明确只同意封口时仅 seal，不 approve/start。明确表达相同意图的自由文本有效，不要求固定口令；空回执、取消和推荐项不算批准。seal/approve/start 失败先核对原始回执及实际状态，不盲目重做已成功的 seal。已有充分且范围一致的授权在普通继续或恢复时复用。

唯一规划入口是 `trellis-idea-to-closed-plan`。先判断请求关联：独立交付目标新建 task，不修改无关活动 task；关联不明时保持原 task 不变，完成有界核验后仍不确定则向用户澄清；已完成或归档任务的后续工作另建 task，不重开终态。通过原生 `task.py current --json` 和任务记录读取 stage；仅 Trellis CLI 写入状态，workflow 不复制状态转移表。

planned/change-bearing 必须先形成完整方案：详细且合理的有序步骤、依赖、实际仓库与分支、交付物、验证、风险和回退，以及唯一且可观察的停止点与剩余工作；再进行整份方案审查。通过审查后，读取 `task.py plan digest <task>`，向用户展示同一摘要所对应的完整方案并征询批准；明确授权后才 `task.py plan seal <task> --expected-digest <digest>`、approve、start。direct 和 analysis-only 的材料与门禁按唯一规划入口处理。

封口后新需求、现场变化和实施发现均交给 `trellis-idea-to-closed-plan` 模型判断。planned 以已批准 revision 为基线，direct 以已接受的单一变化、owner、验证和回退合同为基线；改变已批准范围或验收的小需求仍属 major。minor 只追加 `execution.md`：基线 revision/分类、触发事实与证据、判断理由、受影响步骤或 direct 合同、实施差异和验证；保持当前 status/stage 继续。用户明确要求的同范围有界增补只授权该项内容。major 或有界取证后仍不能确认 minor 时，停止相关动作，由规划入口选择最早受影响 stage，调用原生 `task.py replan <task> --to <stage> "<reason>"`，使旧 seal/approval 失效。该入口支持 in_progress 和 planning/plan_closed；direct 资格失效回 intake。重新完整审查、展示方案并取得明确批准后才能继续。未封口 planning 修改通过原生阶段接口退回受影响阶段，不能复用旧批准；不手写 `task.json` 或 `meta.planning`。

使用原生 `task.py select <task>` 只选择上下文：它不改变阶段或分支，不触发 after_start Hook，也不授予实施权限。`create --no-start` 有意保留之前的指针。切换前保存旧检查点；存在活动 Channel 工作时，按 `trellis-channel` 的多目标流程暂停补充并排空已派发单元和预留，保留待处理单元及旧阶段。不要终止/重试或自动重启用户停止的任务。普通继续/压缩恢复保留检查点快速路径。

## Trellis 系统（Trellis System）

### 开发者身份（Developer Identity）

首次使用时初始化身份：

```bash
python3 ./.trellis/scripts/init_developer.py <your-name>
```

创建 `.trellis/.developer`（由 git 忽略）和 `.trellis/workspace/<your-name>/`。

### Spec 系统（Spec System）

`.trellis/spec/` 按包和层保存编码指南。

- `.trellis/spec/<package>/<layer>/index.md`——包含**开发前清单（Pre-Development Checklist）**和**质量检查（Quality Check）**的入口，实际指南位于它链接的 `.md` 文件。
- `.trellis/spec/guides/index.md`——跨包思考指南。

```bash
python3 ./.trellis/scripts/get_context.py --mode packages   # list packages / layers
```

**更新 spec 的时机**：发现新的模式/约定、需要固化错误修复预防措施或形成新的技术决策。

### 任务系统（Task System）

每个任务在 `.trellis/tasks/{MM-DD-name}/` 下有自己的目录，其中包含 `task.json`、`prd.md`、可选的 `design.md`、可选的 `implement.md`、可选的 `research/`，以及在支持子代理的平台上使用的上下文清单（`implement.jsonl`、`check.jsonl`）。

```bash
# Task lifecycle
python3 ./.trellis/scripts/task.py create "<title>" [--slug <name>] [--parent <dir>]
python3 ./.trellis/scripts/task.py select <name>         # context only, preserve phase
python3 ./.trellis/scripts/task.py plan digest <name>    # review the complete plan before approval
python3 ./.trellis/scripts/task.py plan seal <name> --expected-digest <digest>
python3 ./.trellis/scripts/task.py plan approve <name> --revision <n> --basis "<actual approval>"
python3 ./.trellis/scripts/task.py start <name>          # begin only when start gates pass
python3 ./.trellis/scripts/task.py replan <name> --to <stage> "<reason>" # earliest affected stage
python3 ./.trellis/scripts/task.py current --source      # show active task and source
python3 ./.trellis/scripts/task.py finish                # clear active task (triggers after_finish hooks)
python3 ./.trellis/scripts/task.py archive <name>        # move to archive/{year-month}/
python3 ./.trellis/scripts/task.py list [--mine] [--status <s>]
python3 ./.trellis/scripts/task.py list-archive

# Code-spec context (injected into implement/check agents via JSONL).
# `implement.jsonl` / `check.jsonl` are seeded (empty) on `task create` for sub-agent-capable
# platforms; the AI curates real spec + research entries during planning. `validate` fails
# and `start` refuses while a seeded manifest is still empty — sub-agents would run with
# zero spec context. Pass `start --allow-empty-context` when that is intentional.
python3 ./.trellis/scripts/task.py add-context <name> <action> <file> <reason>
python3 ./.trellis/scripts/task.py list-context <name> [action]
python3 ./.trellis/scripts/task.py validate <name>

# Task metadata
python3 ./.trellis/scripts/task.py set-branch <name> <branch>
python3 ./.trellis/scripts/task.py set-base-branch <name> <branch>    # PR target
python3 ./.trellis/scripts/task.py set-scope <name> <scope>
python3 ./.trellis/scripts/task.py set-meta <name> delivery_mode analysis_only

# Hierarchy (parent/child)
python3 ./.trellis/scripts/task.py add-subtask <parent> <child>
python3 ./.trellis/scripts/task.py remove-subtask <parent> <child>

# PR creation
python3 ./.trellis/scripts/task.py create-pr [name] [--dry-run]
```

> 运行 `python3 ./.trellis/scripts/task.py --help` 查看权威的最新命令列表。

**当前任务机制（Current-task mechanism）**：`task.py create` 创建任务目录；会话身份可用时，自动设置每会话活动任务指针，让规划面包屑立即生效。`task.py start` 写入同一指针（已设置时保持幂等），并将 `task.json.status` 从 `planning` 切换为 `in_progress`。状态存放在 `.trellis/.runtime/sessions/`。如果 Hook 输入、`TRELLIS_CONTEXT_ID` 或平台原生会话环境变量没有提供上下文键，`task.py start` 会给出会话身份提示，因为它无法持久化会话指针；只读上下文仍可投影唯一的开发者所属可恢复任务。`task.py finish` 删除当前会话文件，状态不变。`task.py archive <task>` 写入 `status=completed`，将目录移动到 `archive/`，并删除仍指向该任务的运行时会话文件。

### 工作区系统（Workspace System）

在 `.trellis/workspace/<developer>/` 下记录每个 AI 会话，用于跨会话跟踪。

- `journal-N.md`——会话日志。每个文件**最多 2000 行**，超过后自动创建 `journal-(N+1).md`。
- `index.md`——个人索引（会话总数、最近活动）。

```bash
python3 ./.trellis/scripts/add_session.py --title "Title" --commit "hash" --summary "Summary"
```

### 上下文脚本（Context Script）

```bash
python3 ./.trellis/scripts/get_context.py                            # full session runtime
python3 ./.trellis/scripts/get_context.py --mode packages            # available packages + spec layers
python3 ./.trellis/scripts/get_context.py --mode phase --step <X.Y>  # detailed guide for a workflow step
```

---

<!--
  工作流状态面包屑合同（WORKFLOW-STATE BREADCRUMB CONTRACT；编辑以下标记块前阅读）

  下方 ## Phase Index 区域中的 [workflow-state:STATUS] 块是每个支持平台的
  UserPromptSubmit Hook 读取的每轮 <workflow-state> 面包屑唯一事实来源。
  inject-workflow-state.py（Python 平台）和 inject-workflow-state.js（OpenCode 插件）
  只解析这些块；v0.5.0-rc.0 之后，脚本中不再内置回退字典。

  STATUS 字符集为 [A-Za-z0-9_-]+。Hook 找不到标签时，会降级为通用的
  "Refer to workflow.md for current step."，让用户能发现并修复损坏的 workflow.md。

  不变量（test/regression.test.ts）：
    每个标记为 `[required · once]` 的工作流步骤，都必须在所属阶段的
    [workflow-state:*] 块中有对应的约束行。面包屑是每轮唯一的提示通道；
    如果没有提到必需步骤，AI 会静默跳过它（阶段一规划门禁和阶段 3.4 提交门禁
    都曾因这一缺口被跳过）。

  标签与阶段范围：
    [workflow-state:no_task]      → 无活动任务；阶段一之前
    [workflow-state:unbound_task] → 开发者有一个任务，但没有会话指针
    [workflow-state:unbound_ambiguous] → 开发者有多个任务，但没有会话指针
    [workflow-state:unbound_ambiguous-inline] → unbound_ambiguous 的 Codex inline 版本
    [workflow-state:task_error]   → 活动任务记录不可读；继续前先修复
    [workflow-state:planning]     → 整个阶段一（status='planning'）
    [workflow-state:planning-inline] → 阶段一的 Codex inline 版本
    [workflow-state:in_progress]  → 阶段二与阶段 3.2–3.4
                                    （从 task.py start 到 task.py archive，
                                    status 保持 'in_progress'）
    [workflow-state:in_progress-inline] → 阶段二/三的 Codex inline 版本
    [workflow-state:completed]    → 当前不可达：cmd_archive 在同一次调用中
                                    修改状态并移动目录，解析器因此失去指针。
                                    保留此块以支持未来显式的
                                    in_progress→completed 转换。

  编辑清单：
    - 修改 [workflow-state:STATUS] 块时，同时检查对应阶段的 `[required · once]`
      工作流步骤是否同步
    - 编辑后运行 `trellis update`，通过按块管理的替换将新正文推送到下游项目
    - 完整运行时合同：
      .trellis/spec/cli/backend/workflow-state-contract.md
-->

## 阶段索引（Phase Index）

```
Phase 1: Plan    → classify, then create planning artifacts for work that needs a task
Phase 2: Execute → implement only after task status is in_progress
Phase 3: Finish  → verify, update spec, commit, and wrap up
```

### 请求分流（Request Triage）

- 直接小任务：对于边界清晰、只涉及一个表面且可以立即验证的操作，可以不创建 Trellis 任务直接进行，但仍遵守通常安全规则。如果探索扩大了范围，或发现需要设计、owner、发布或持久记录，先停止并创建任务。
- 复杂任务：询问是否可以创建 Trellis 任务并进入规划。如果用户拒绝，不进行大范围内联实施；解释、澄清范围或建议拆分为更小的任务。
- 用户批准创建任务不等于批准开始实施，仍须先完成规划。

### analysis-only 任务

当 `task.json.meta.delivery_mode = "analysis_only"` 且 `prd.md` 明确证据交付物以及产品源码、运行时配置、部署、凭据和外部系统均不变的边界时，analysis-only 任务符合条件。复杂度、跨 owner 范围、多个证据单元、建议或未解决的产品选择都不会使它失去资格。用户的研究请求授权主会话完成所请求的证据工作。

让任务保持 `planning`：写入并验证研究、审查或设计证据，提交任务资产后直接归档。不要运行 `task.py start`，不要配置实施上下文，不要求 Planning Seal，也不等待第二次实施批准。如果需要独立子节点证据，在任务中冻结派发方案，并在任何 spawn/send 前取得明确批准；该批准只授权清单中的证据派发。如果证据建议修改受保护目标，记录建议并另建 change-bearing 任务，之后才能实施。

### 规划资产（Planning Artifacts）

- `prd.md`——需求、约束和验收标准。不要在其中放技术设计或执行清单。
- `design.md`——复杂任务的技术设计：边界、合同、数据流、取舍、兼容性和发布/回滚形态。
- `implement.md`——复杂任务的执行计划：有序清单、验证命令、审查门禁和回滚点。
- `implement.jsonl` / `check.jsonl`——子代理上下文使用的 spec 与研究清单，不替代 `implement.md`。
- direct 可保留 PRD 短路径。planned/change-bearing 在 start 前必须有完整决策、设计与执行方案；细化有序步骤和唯一停止点后才审查与展示，字段和阶段门禁以唯一规划入口为准。

对于阅读量较大的研究、审查或调查，将无法在当前有界会话中持久化一个有用结论的工作拆成证据单元。每个单元在开始下一个单元前记录一个问题或范围、最小证据、落点、停止条件、结论或阻塞、未知项和恢复点。按一个普通上下文窗口控制规模，不承诺精确 token 或时间；例行导航无需记录。

### 父子任务树（Parent / Child Task Trees）

当一个用户请求包含多个可独立验证的交付物时使用父任务。父任务负责源需求集合、任务图、跨子任务验收标准和最终集成审查；除非父任务本身也有直接工作，否则通常不作为实施目标。

对可以独立规划、实施、检查和归档的交付物使用子任务。父子结构不是依赖系统：如果一个子任务必须等待另一个子任务，在该子任务的 `prd.md` / `implement.md` 中写明顺序，并保持每个子任务的验收标准可测试。

使用 `task.py create "<title>" --slug <name> --parent <parent-dir>` 创建新子任务。使用 `task.py add-subtask <parent> <child>` 关联已有任务，使用 `task.py remove-subtask <parent> <child>` 解除错误关联。

<!-- 每轮面包屑：无活动任务时显示（阶段一之前）。 -->

[workflow-state:no_task]
没有活动任务。先分类当前轮次。owner 清晰、可以立即验证的直接小任务，可以在通常安全规则下不创建 Trellis 任务直接进行。
如果范围扩大，或需要设计、owner、发布、凭据或持久记录，继续前先创建 Trellis 任务。
复杂任务：询问用户是否可以创建 Trellis 任务并进入规划。如果用户拒绝，解释、澄清范围或建议拆分为更小任务。
[/workflow-state:no_task]

<!-- 每轮面包屑：存在一个可恢复任务且无直接会话绑定时显示。 -->

[workflow-state:unbound_task]
已有一个由开发者拥有的任务，但没有直接会话绑定。检查原生 `task.py current --json`：非空 `session_source` 表示直接身份已可用；未绑定来源仍表示没有任务绑定。根据用户明确意图选择已有任务，不要猜测或创建重复任务。先恢复其规划/状态门禁。只有激活合同允许时，才在 Planning Seal 和 change-bearing 任务实施授权之后运行原生 `task.py start <task>`。符合条件的 `analysis_only` 任务保持 planning，不运行 start。缺少身份时单独报告；绝不虚构身份或编辑运行时指针。
[/workflow-state:unbound_task]

<!-- 每轮面包屑：存在多个可恢复任务且无直接会话绑定时显示。 -->

[workflow-state:unbound_ambiguous]
多个由开发者拥有的任务没有直接会话绑定。检查原生 `task.py current --json`：非空 `session_source` 表示直接身份已可用；未绑定来源仍表示没有任务绑定。根据用户明确意图选择已有任务，不要猜测或创建重复任务。先恢复其规划/状态门禁。只有激活合同允许时，才在 Planning Seal 和 change-bearing 任务实施授权之后运行原生 `task.py start <task>`。符合条件的 `analysis_only` 任务保持 planning，不运行 start。缺少身份时单独报告；绝不虚构身份或编辑运行时指针。
[/workflow-state:unbound_ambiguous]

[workflow-state:unbound_ambiguous-inline]
多个由开发者拥有的任务没有直接会话绑定。检查原生 `task.py current --json`：非空 `session_source` 表示直接身份已可用；未绑定来源仍表示没有任务绑定。根据用户明确意图选择已有任务，不要猜测或创建重复任务。先恢复其规划/状态门禁。只有激活合同允许时，才在 Planning Seal 和 change-bearing 任务实施授权之后运行原生 `task.py start <task>`。符合条件的 `analysis_only` 任务保持 planning，不运行 start。缺少身份时单独报告；绝不虚构身份或编辑运行时指针。
[/workflow-state:unbound_ambiguous-inline]

<!-- 每轮面包屑：活动任务记录不可读时显示。 -->

[workflow-state:task_error]
无法读取活动任务记录。不要创建或激活其他任务。
检查上方命名的任务目录并修复其 task.json。它必须是有效 JSON 对象，且 status 非空。
保留现有任务字段和资产。如果无法安全确定正确状态，在重建记录前询问用户。
[/workflow-state:task_error]

### 阶段一：规划（Phase 1: Plan）
- 1.0 创建任务 `[required · once]`（仅在获得创建任务同意后）
- 1.1 需求探索 `[required · repeatable]`（`prd.md`；复杂任务还需要 `design.md` + `implement.md`）
- 1.2 研究 `[optional · repeatable]`
- 1.3 配置上下文 `[required · once]`——Claude Code、Cursor、OpenCode、Codex、Kiro、Gemini、Qoder、CodeBuddy、Copilot、Droid、Pi、Oh My Pi、ZCode、Snow、Reasonix、Grok、Kimi Code（仅派发子代理的平台；inline 和符合条件的 analysis-only 任务跳过）
- 1.4 激活任务 `[required · once]`（仅 change-bearing 任务：审查门禁后运行 `task.py start`；状态 → in_progress）
- 1.5 完成标准

<!-- 每轮面包屑：整个阶段一显示（status='planning'）。 -->

[workflow-state:planning]
加载 `trellis-idea-to-closed-plan`；保持 planning。
如果 `task.json.meta.delivery_mode = "analysis_only"`，无论复杂度或跨 owner 范围如何，都完成有界证据工作；PRD 必须写明证据交付物和受保护目标不变边界。不要运行 Planning Seal 或等待实施批准。涉及受保护目标的建议必须另建 change-bearing 任务。
对于 planned/change-bearing 工作，依唯一规划入口形成完整方案及详细有序步骤和唯一停止点；direct 按 direct_ready 合同处理。先展示方案，再征询“封口并批准推进”或“补充／修改方案”；明确合并授权后才原生 seal/approve/start，同一方案不重复确认。研究建议和开放的产品选择可以记录，但不要将其封口为实施决策。持久化定义请求所需的答复，并继续同一规划循环。
多交付物范围：考虑父任务和可独立验证的子任务；依赖必须写入子任务资产，不能从树结构位置推断。
子代理模式：在 start 前维护 `implement.jsonl` 和 `check.jsonl` 作为 spec/研究清单。
planned/change-bearing start 需要原生 plan seal，以及对当前任务当前实质版本的匹配批准。选择上下文不构成批准。
[/workflow-state:planning]

<!-- Codex 使用默认 codex.dispatch_mode=inline 时，阶段一持续显示的每轮面包屑。
     这是 [workflow-state:planning] 的 Codex 专用替代块。主 Agent 在阶段二直接编辑代码，
     因此跳过 JSONL 整理；inline 工作流加载 `trellis-before-dev`，而不是向子代理注入 JSONL。 -->

[workflow-state:planning-inline]
加载 `trellis-idea-to-closed-plan`；保持 planning。
如果 `task.json.meta.delivery_mode = "analysis_only"`，无论复杂度或跨 owner 范围如何，都完成有界证据工作；PRD 必须写明证据交付物和受保护目标不变边界。不要运行 Planning Seal 或等待实施批准。涉及受保护目标的建议必须另建 change-bearing 任务。
对于 planned/change-bearing 工作，依唯一规划入口形成完整方案及详细有序步骤和唯一停止点；direct 按 direct_ready 合同处理。先展示方案，再征询“封口并批准推进”或“补充／修改方案”；明确合并授权后才原生 seal/approve/start，同一方案不重复确认。研究建议和开放的产品选择可以记录，但不要将其封口为实施决策。持久化定义请求所需的答复，并继续同一规划循环。
多交付物范围：考虑父任务和可独立验证的子任务；依赖必须写入子任务资产，不能从树结构位置推断。
Inline 模式跳过 JSONL 整理；阶段二通过 `trellis-before-dev` 读取任务资产和 spec。
planned/change-bearing 任务开始前需要原生 plan seal，以及对当前任务当前实质版本的匹配批准。选择上下文不构成批准。
[/workflow-state:planning-inline]

### 阶段二：执行（Phase 2: Execute）
- 2.1 实施 `[required · repeatable]`
- 2.2 质量检查 `[required · repeatable]`
- 2.3 回滚 `[on demand]`

<!-- status='in_progress' 时显示的每轮面包屑。
     范围覆盖阶段二和阶段 3.2-3.4（从 task.py start 到 task.py archive 期间状态保持
     'in_progress'，只有 archive 会翻转状态）。因此正文必须覆盖从实施到提交的每个必需步骤，
     包括阶段 3.3 spec 更新和阶段 3.4 提交。 -->

子代理派发协议适用于所有平台和所有子代理，包括使用原生 Codex `SubagentStart` 注入上下文并以子代理侧读取为后备的模式、Gemini/Qoder/Copilot/Reasonix/Trae/Grok/Kimi Code/DeepSeek Harness、由 Hook 支持的 ZCode/Snow 以及 `trellis-research`：每个派发提示都必须先写 `Active task: <task path from task.py current>`，再写角色指令。Grok Build 使用 `spawn_subagent`，并将 `subagent_type` 设为 Trellis Agent 名称（例如 `trellis-implement`）。Kimi Code 派发内置 `coder` / `explore` 子代理，并提供对应的 `.kimi-code/skills/trellis-<role>/SKILL.md` 指令。DeepSeek Harness 要求子代理恰好加载一次对应的 `.dsh/skills/trellis-agent-<role>/SKILL.md`，再按能力选择同步路径。如果可选伴随插件提供 `trellis_wait`，使用默认可继续的后台模式派发 `subagent`，继续独立工作；依赖门即将满足时，对每个依赖子代理 ID 调用一次 `trellis_wait`，每次调用都要等到 DSH 排入该子代理的原生结算通知后才返回。没有 `trellis_wait` 时，从一开始就为每个子代理设置 `run_in_background: false`，避免依赖门越过它。不得用 shell sleep、轮询循环、`job_output`、重复 `list_agents` 或其他长命令模拟等待，也不得让后台子代理脱离事件驱动的等待路径。

[workflow-state:in_progress]
实质重规划后先完善并展示方案，征询封口并批准推进或补充意见，明确确认后才 seal/approve/start；已有充分授权不重复询问。
新请求或实施发现交给 `trellis-idea-to-closed-plan`，按上述关联与 minor/major 合同处理：minor 写入 `execution.md` 并保持当前 status/stage；major 停止相关动作，原生 replan 到最早受影响阶段，重新完整审查并取得明确批准。独立交付另建 task，关联不明先澄清，不修改无关 task 或终态。
`trellis-implement` / `trellis-research` 表示通过平台子代理机制派发的角色，不是主会话自行加载的 Skill（Claude Code 使用 Task/Agent 工具，不使用 Skill 工具）。`trellis-update-spec` 是 Skill。`trellis-check` 同时存在于两种入口；代码变更后验证时优先使用 Agent/角色入口。
DeepSeek Harness 的角色指令以互不冲突的 `trellis-agent-implement` / `trellis-agent-check` / `trellis-agent-research` Skill 分发到 `.dsh/skills/`。主会话不得自行加载；要求子代理恰好加载一次对应角色 Skill。提供 `trellis_wait` 时，使用默认后台模式，继续独立工作，然后对每个依赖子代理 ID 调用一次 `trellis_wait`，消费原生结算通知后才进入依赖门。未提供时，从一开始就为每个子代理设置 `run_in_background: false`。不得轮询、sleep 或启动没有事件驱动等待路径的后台子代理。
流程：`trellis-implement` → `trellis-check` → `trellis-update-spec` → 提交（阶段 3.4）→ `/trellis:finish-work`。
仅在明确选择 `codex.dispatch_mode: auto` 时使用此块。子代理自豁免：如果当前已经是 `trellis-implement`，不得再派发 `trellis-implement` 或 `trellis-check`；如果当前已经是 `trellis-check`，不得再派发 `trellis-check` 或 `trellis-implement`。只有主会话负责派发。
派发提示必须以 `Active task: <task path from task.py current>` 开始。读取上下文的顺序为：JSONL 条目 → `prd.md` → 存在时的 `design.md` → 存在时的 `implement.md`。
[/workflow-state:in_progress]

<!-- 每轮面包屑：status='in_progress' 且 Codex 使用默认
     codex.dispatch_mode=inline 时显示。仅供 Codex 替代
     [workflow-state:in_progress]；主会话直接编辑代码，不派发子代理。 -->

[workflow-state:in_progress-inline]
实质重规划后先完善并展示方案，征询封口并批准推进或补充意见，明确确认后才 seal/approve/start；已有充分授权不重复询问。
流程：`trellis-before-dev` → 编辑 → `trellis-check` → 验证 → `trellis-update-spec` → 提交（阶段 3.4）→ `/trellis:finish-work`。
新请求或实施发现交给 `trellis-idea-to-closed-plan`，按上述关联与 minor/major 合同处理：minor 写入 `execution.md` 并保持当前 status/stage；major 停止相关动作，原生 replan 到最早受影响阶段，重新完整审查并取得明确批准。独立交付另建 task，关联不明先澄清，不修改无关 task 或终态。
Inline 模式不派发 implement/check 子代理。
已选工作流仍可使用明确的 Channel 独立证据子节点；不得用主会话自称通过替代必需的独立证据。
读取上下文的顺序为：`prd.md` → 存在时的 `design.md` → 存在时的 `implement.md`，再读取 Skill 加载的相关 spec/研究。
[/workflow-state:in_progress-inline]

### 阶段三：完成（Phase 3: Finish）
- 3.2 调试复盘 `[on demand]`
- 3.3 更新 Spec `[required · once]`
- 3.4 提交变更 `[required · once]`
- 3.5 收尾提醒

> 注意：步骤 3.1 已并入 2.2（最后一次迭代的全范围检查）和 3.4（提交前置检查）。保留原有编号，避免破坏外部引用。

<!-- 每轮面包屑：status='completed' 时显示。
     当前正常流程不可达：cmd_archive 在同次调用写入 status='completed'
     并将目录移至 archive/，活动任务解析器失去指针，Hook 不会作用于归档任务。
     保留此块供未来状态转换重设计使用（如显式 in_progress→completed 命令）。
     修改时遵循与活动块相同的 spec 入口。 -->

[workflow-state:completed]
代码已提交。运行 `/trellis:finish-work`；如果工作树仍脏，先回到阶段 3.4。
[/workflow-state:completed]

### 规则（Rules）

1. 确认当前阶段，然后从该阶段的下一步继续
2. 按阶段内顺序执行；不能跳过 `[required]` 步骤
3. 阶段可以回退（例如执行发现 PRD 缺陷 → 回到规划修复 → 再次进入执行）
4. 标记为 `[once]` 的步骤已有产物时跳过，不重复运行
5. 读取原生 task status/stage 恢复下一步；资产存在与否只用于核对材料，不代表阶段已完成。direct 按短路径合同恢复；planned 任务缺少完整设计、详细有序实施步骤或唯一停止点时，规划尚未完成。

### 活动任务路由（Active Task Routing）

活动任务中的用户请求符合下列意图时，先路由，再按需要加载阶段步骤详情。

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

- 新任务、规划阶段或活动任务的重大变化 → `trellis-idea-to-closed-plan`。
- 明确符合条件的 `analysis_only` → 在规划中完成证据，然后提交资产并直接归档。
- `in_progress` 实施/检查 → 派发 `trellis-implement` / `trellis-check`。
- 重复调试 → `trellis-break-loop`；spec 更新 → `trellis-update-spec`。

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

[codex-inline, Kilo, Antigravity, Devin]

- 新任务、规划阶段或活动任务的重大变化 → `trellis-idea-to-closed-plan`。
- 明确符合条件的 `analysis_only` → 在规划中完成证据，然后提交资产并直接归档。
- 编辑前 → `trellis-before-dev`；编辑后 → `trellis-check`。
- 重复调试 → `trellis-break-loop`；spec 更新 → `trellis-update-spec`。

[/codex-inline, Kilo, Antigravity, Devin]

### 防护栏（Guardrails）

- PRD 写明有界证据和受保护目标不变边界时，`analysis_only` 任务可以在 `planning` 中完成；复杂度、跨 owner 范围、多个证据单元和建议都不会使其失去资格。任何受保护目标变更都需要单独的 change-bearing 任务。
- 创建任务批准不等于实施批准；change-bearing 实施需等待资产审查后的 `task.py start`。
- direct 保留 PRD 短路径；planned 必须先形成完整设计、有序实施步骤和唯一停止点。
- 规划必须持久化到任务资产；报告完成前必须运行检查。

### 加载步骤详情（Loading Step Detail）

每一步都可运行以下命令获取详细指引：

```bash
python3 ./.trellis/scripts/get_context.py --mode phase --step <step>
# e.g. python3 ./.trellis/scripts/get_context.py --mode phase --step 1.1
```

---

## 阶段一：规划（Phase 1: Plan）

目标：分类请求；只有符合条件的直接小任务才可不创建任务立即执行；需要任务时创建规划资产。

#### 1.0 创建任务（Create task）`[required · once]`

只有取得创建任务同意后才创建任务目录。命令会将状态设为 `planning`、写入 `task.json`、创建默认 `prd.md`；会话身份可用时，还会自动将新任务设为当前目标：

```bash
python3 ./.trellis/scripts/task.py create "<task title>" --slug <name>
```

`--slug` 仅填写人类可读名称。不要包含 `MM-DD-` 日期前缀；`task.py create` 会自动添加该前缀。

对于任务树，先创建父任务，再使用 `--parent <parent-dir>` 创建各子任务。不要因为存在子任务就启动父任务；启动拥有下一个可独立验证交付物的子任务。

命令成功后，每轮面包屑会自动切换为 `[workflow-state:planning]`，要求 AI 留在规划阶段。

这里仅运行 `create`，不要同时运行 `start`。`start` 会将状态切换为 `in_progress`，在规划资产审查前就把面包屑切换到实施阶段。将 `start` 留到步骤 1.4。

对于只交付证据的任务，在创建时或使用 `task.py set-meta` 设置 `task.json.meta.delivery_mode = "analysis_only"`。任务继续前，其 PRD 必须写明证据交付物并排除受保护目标变更。

如果 `python3 ./.trellis/scripts/task.py current --source` 已指向任务，则跳过此步骤。

#### 1.1 需求探索（Requirement exploration）`[required · repeatable]`

加载 `trellis-idea-to-closed-plan` Skill，按照其指引处理任务状态、形成完整方案并收敛停止点。

对于符合条件的 analysis-only 任务，在本阶段收敛 PRD 边界，然后完成声明的研究、审查或设计工作。不需要 start 审查或运行 `task.py start`；记录验收证据后直接进入阶段 3.3。

该 Skill 会引导你：
- 将最多三个相互独立的实质前沿问题成组处理；只有依赖顺序要求时才一次询问一个
- 优先研究，减少直接询问用户
- 优先提供选项，减少开放式提问
- 每次用户答复后立即更新 `prd.md`
- 交付物可独立验证时，将大范围拆成父任务和子任务
- 让 `prd.md` 专注于需求和验收标准
- 复杂任务在开始实施前生成 `design.md` 和 `implement.md`
- 对阅读量大的工作拆成证据单元，并在继续前持久化每个单元的结论或恢复点
- 在 change-bearing 最终方案复核前，对任务资产运行 Planning Seal 收口检查，核对目标、分支、依赖、发布、验证、回滚、动态事实处理和实施决策；检查不调用 seal，明确最终确认后才封口；`analysis_only` 不使用此门禁

考虑拆分父子任务时：
- 一个请求包含多个可独立验证的交付物时使用父任务。
- 父任务负责原始需求、子任务映射、跨子任务验收标准和最终集成审查。
- 子任务负责可以独立规划、实施、检查和归档的实际交付物。
- 父子结构不是依赖系统。如果子任务 B 依赖子任务 A，将顺序写入子任务 B 的 `prd.md` / `implement.md`。
- 启动拥有下一个交付物的子任务。除非父任务本身有直接实施工作，否则不要启动父任务。

需求变化时回到此步骤并修改相关资产。

#### 1.2 研究（Research）`[optional · repeatable]`

需求探索期间可以随时研究。研究不限于本地代码；可以使用可用的 MCP 服务、Skill、网页搜索等工具查询第三方库文档、行业实践、API 参考等外部信息。

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

派发研究子代理：

- **Agent 类型**：`trellis-research`
- **任务描述**：研究 <具体问题>
- **关键要求**：研究输出必须持久化到 `{TASK_DIR}/research/`
- **DeepSeek Harness**：告知子代理恰好加载一次 `trellis-agent-research`。如果提供 `trellis_wait`，使用默认可继续的后台模式；有用时并发派发独立问题，继续不相关工作，然后对每个子代理 ID 调用一次 `trellis_wait` 并消费每个结算通知后再推进。没有 `trellis_wait` 时，每个必需子代理都设置 `run_in_background: false`；不得轮询或 sleep。

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

[codex-inline, Kilo, Antigravity, Devin]

直接在主会话中研究，并将发现写入 `{TASK_DIR}/research/`。`codex-inline` 是将工作保留在主会话中的明确模式。

[/codex-inline, Kilo, Antigravity, Devin]

**研究资产约定**：
- 每个研究主题一个文件（例如 `research/auth-library-comparison.md`）
- 在文件中记录第三方库用法示例、API 参考和版本约束
- 记录发现的相关 spec 文件路径，供后续引用

头脑风暴和研究可以交错进行：遇到技术问题先暂停对话进行研究，再回来继续与用户沟通。

**核心原则**：研究输出必须写入文件，不能只留在对话中。对话会被压缩，文件不会。

#### 1.3 配置上下文（Configure context）`[required · once]`

符合条件的 analysis-only 任务不会进入阶段二，也不会派发实施/检查 Agent，因此跳过此步骤。

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

整理 `implement.jsonl` 和 `check.jsonl`，让阶段二子代理获得正确的 spec/研究上下文。这些文件在 `task create` 时以一行自描述的 `_example` 种子创建；此处需要填入真实条目。

**位置**：`{TASK_DIR}/implement.jsonl` 和 `{TASK_DIR}/check.jsonl`（已存在）。

**格式**：每行一个 JSON 对象——`{"file": "<path>", "reason": "<why>"}`。路径相对于仓库根目录。

**写入内容**：
- **Spec 文件**——`.trellis/spec/<package>/<layer>/index.md` 以及与任务相关的具体指南文件（`error-handling.md`、`conventions.md` 等）
- **研究文件**——子代理需要查阅的 `{TASK_DIR}/research/*.md`

**不要写入**：
- 代码文件（`src/**`、`packages/**/*.ts` 等）；子代理会在实施时读取，不在此处预注册
- 即将修改的文件；原因相同

**两个文件的分工**：
- `implement.jsonl` → 实施子代理正确编写代码所需的 spec 和研究
- `check.jsonl` → 检查子代理所需的 spec（质量指南、检查约定，以及必要时的相同研究）

这些清单不替代 `implement.md`。`implement.md` 是复杂任务的人类可读执行计划；JSONL 文件只列出要注入或加载的上下文文件。

**发现相关 spec**：

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
```

该命令列出每个包及其 spec 层和路径。选择与本任务领域匹配的条目。

**追加条目**：

可以在编辑器中直接编辑 JSONL 文件，也可以使用：

```bash
python3 ./.trellis/scripts/task.py add-context "$TASK_DIR" implement "<path>" "<reason>"
python3 ./.trellis/scripts/task.py add-context "$TASK_DIR" check "<path>" "<reason>"
```

存在真实条目后可以删除 `_example` 种子行（可选；消费者会自动跳过它）。

就绪门禁：运行 `task.py start` 前，`implement.jsonl` 和 `check.jsonl` 都必须至少包含一个真实的 `{"file": "...", "reason": "..."}` 条目。只有 `_example` 种子行不算就绪。

只有两个文件都已有整理好的真实条目时才跳过此步骤。

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

[codex-inline, Kilo, Antigravity, Devin]

跳过此步骤。阶段二由 `trellis-before-dev` Skill 直接加载上下文。

[/codex-inline, Kilo, Antigravity, Devin]

#### 1.4 激活任务（Activate task）`[required · once]`

此步骤仅适用于 change-bearing 任务。符合条件的 analysis-only 任务保持 `planning`，完成证据工作后不运行 `task.py start`，直接进入阶段 3.3。

完成 Planning Seal 收口检查并展示最终方案，取得“封口并批准推进”的明确授权后，原生 plan seal，再以实际 revision 记录 approve；门禁通过后将任务状态切换为 `in_progress`，不重复索取同一实施批准：

```bash
python3 ./.trellis/scripts/task.py start <task-dir>
```

direct 按原生 direct_ready 合同使用 PRD；planned 在 start 前必须通过完整方案结构校验和审查，包括详细有序步骤、依赖、验证与唯一停止点。在派发子代理的平台上，start 前 `implement.jsonl` 和 `check.jsonl` 都必须有真实整理条目。运行时消费者为兼容性可以容忍清单缺失或只有种子内容，但这种容忍不代表规划已就绪。

命令成功后，面包屑自动切换为 `[workflow-state:in_progress]`，随后进入阶段二和阶段三。

如果 `task.py start` 因会话身份错误而失败（Hook 输入、`TRELLIS_CONTEXT_ID` 或平台原生会话环境中没有上下文键），按照错误提示设置会话身份后重试。

#### 1.5 完成标准（Completion criteria）

| 条件（Condition） | 必需（Required） |
|------|:---:|
| `prd.md` 存在 | ✅ |
| Change-bearing 任务：用户确认实施 | ✅ |
| Change-bearing 任务：已运行 `task.py start`（status = in_progress） | ✅ |
| Analysis-only 任务：准确的元数据、明确的证据交付物、已记录验收证据，且受保护目标未变 | ✅ |
| `research/` 有资产（复杂任务） | 推荐 |
| `design.md` 存在（复杂任务） | ✅ |
| `implement.md` 存在（复杂任务） | ✅ |
| Change-bearing 任务：已记录 Planning Seal 收口检查；静态实施决策和路径已锁定 | ✅ |

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

| Change-bearing 任务：`implement.jsonl` 和 `check.jsonl` 都必须至少包含真实整理条目（种子行不算） | ✅ |

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

---

## 阶段二：执行（Phase 2: Execute）

目标：将已审查的规划资产转化为通过质量检查的代码。

#### 2.1 实施（Implement）`[required · repeatable]`

[Claude Code, Cursor, OpenCode, codex-sub-agent, CodeBuddy, Droid, Pi, ZCode, Snow, Oh My Pi]

派发实施子代理：

- **Agent 类型**：`trellis-implement`
- **任务描述**：根据已审查的任务资产实施，参考 `{TASK_DIR}/research/` 下的材料；完成后运行项目 lint 和类型检查。
- **派发提示约束**：提示必须以 `Active task: <task path>` 开始，然后告知派发的 Agent 已经是 `trellis-implement` 子代理，必须直接实施，不得再派发其他 `trellis-implement` / `trellis-check`。

平台 Hook/插件会自动处理：
- 读取 `implement.jsonl`，并将引用的 spec/研究文件注入 Agent 提示
- 注入存在时的 `prd.md`、`design.md` 和 `implement.md`
- 对 Codex，`SubagentStart` 提供原生上下文注入；Agent 配置保留子代理侧读取作为后备路径

[/Claude Code, Cursor, OpenCode, codex-sub-agent, CodeBuddy, Droid, Pi, ZCode, Snow, Oh My Pi]

[Gemini, Qoder, Copilot, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

派发实施子代理：

- **Agent 类型**：`trellis-implement`
- **任务描述**：根据已审查的任务资产实施，参考 `{TASK_DIR}/research/` 下的材料；完成后运行项目 lint 和类型检查。
- **派发提示约束**：提示必须以 `Active task: <task path>` 开始，然后明确告知派发的 Agent 已经是 `trellis-implement`，必须直接实施，不得再派发 `trellis-implement` / `trellis-check`。
- **DeepSeek Harness**：告知子代理恰好加载一次 `trellis-agent-implement`。提供 `trellis_wait` 时，使用默认后台模式，继续独立工作，然后对该子代理 ID 等待一次并消费其成功的原生结算通知后才进入阶段 2.2。没有 `trellis_wait` 时，派发设置 `run_in_background: false`。不得轮询或 sleep。

拉取式子代理定义会自动处理上下文加载：
- 使用 `task.py current --source` 解析活动任务，然后读取 `prd.md`、存在时的 `design.md` 和 `implement.md`
- 读取 `implement.jsonl`，并要求 Agent 在编码前加载每个引用的 spec/研究文件

[/Gemini, Qoder, Copilot, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

[Kiro]

派发实施子代理：

- **Agent 类型**：`trellis-implement`
- **任务描述**：根据已审查的任务资产实施，参考 `{TASK_DIR}/research/` 下的材料；完成后运行项目 lint 和类型检查。
- **派发提示约束**：告知派发的 Agent 已经是 `trellis-implement` 子代理，必须直接实施，不得再派发 `trellis-implement` / `trellis-check`。

平台前置处理会自动加载上下文：
- 读取 `implement.jsonl`，并将引用的 spec/研究文件注入 Agent 提示
- 注入存在时的 `prd.md`、`design.md` 和 `implement.md`

[/Kiro]

[codex-inline, Kilo, Antigravity, Devin]

1. 加载 `trellis-before-dev` Skill 读取项目指南
2. 读取 `{TASK_DIR}/prd.md`，再读取存在时的 `design.md` 和 `implement.md`
3. 查阅 `{TASK_DIR}/research/` 下的材料
4. 根据已审查资产实施代码
5. 运行项目 lint 和类型检查

[/codex-inline, Kilo, Antigravity, Devin]

#### 2.2 质量检查（Quality check）`[required · repeatable]`

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

派发检查子代理：

- **Agent 类型**：`trellis-check`
- **任务描述**：对照 spec 和任务资产审查全部代码变更；直接修复发现的问题；确保 lint 和类型检查通过。
- **派发提示约束**：提示必须以 `Active task: <task path>` 开始，然后告知派发的 Agent 已经是 `trellis-check` 子代理，必须直接审查/修复，不得再派发其他 `trellis-check` / `trellis-implement`。
- **DeepSeek Harness**：告知子代理恰好加载一次 `trellis-agent-check`。提供 `trellis_wait` 时，使用默认后台模式，继续独立工作，然后对该子代理 ID 等待一次并消费其成功的原生结算通知后才进入阶段三。没有 `trellis_wait` 时，派发设置 `run_in_background: false`。不得轮询或 sleep。

检查 Agent 的职责：
- 对照 spec 审查代码变更
- 对照 `prd.md`、存在时的 `design.md` 和 `implement.md` 审查代码变更
- 自动修复发现的问题
- 运行 lint 和类型检查进行验证
- 必须检查但无法运行、被跳过或以非零状态退出的检查属于阻塞/失败，绝不能算作通过。不要为了推进工作流而降低或改写验收标准。

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

[codex-inline, Kilo, Antigravity, Devin]

加载 `trellis-check` Skill 并按其指引验证代码：
- spec 合规性
- lint / 类型检查 / 测试
- 跨层一致性（变更跨层时）

如果发现问题 → 修复 → 重新检查，直到通过。

[/codex-inline, Kilo, Antigravity, Devin]

**最终检查（阶段 3.4 提交前）**：任务最后一次 2.2 必须覆盖完整范围，不能只检查最近一次实施的改动。使用 `python3 ./.trellis/scripts/get_context.py --mode packages` 列出所有受影响的包，然后加载每个包 spec 索引中的质量检查部分。这可以发现中途局部 2.2 无法发现的跨层/多包问题。

#### 2.3 回滚（Rollback）`[on demand]`

- `check` 暴露 PRD 缺陷 → 返回阶段一，修复 `prd.md`，然后重新执行 2.1
- 实施出错 → 回退代码，重新执行 2.1
- 需要更多研究 → 进行研究（同阶段一的 1.2），将发现写入 `research/`

---

## 阶段三：完成（Phase 3: Finish）

目标：确保代码质量，记录经验和工作过程。

**Analysis-only 完成路径**：阶段一证据工作完成后，验证 PRD 验收标准和不变更边界，然后只针对任务资产进入 3.3 和 3.4，最后运行 `/trellis:finish-work`。不要运行阶段二或 `task.py start`。

#### 3.2 调试复盘（Debug retrospective）`[on demand]`

如果任务涉及重复调试（同一问题被多次修复），加载 `trellis-break-loop` Skill：
- 分类根因
- 解释之前的修复为什么失败
- 提出预防措施

目标是记录调试经验，避免同类问题再次发生。

#### 3.3 更新 Spec（Spec update）`[required · once]`

加载 `trellis-update-spec` Skill，审查本任务是否产生了值得记录的新知识：
- 新发现的模式或约定
- 遇到的陷阱
- 新的技术决策

相应更新 `.trellis/spec/` 下的文档。即使结论是“不需要更新”，也要完成并记录判断过程。

#### 3.4 提交变更（Commit changes）`[required · once]`

**Spec 同步前置检查**：起草提交前询问：本任务是否修复了缺陷，或发现了应写入 `.trellis/spec/` 的非显然知识，以免未来的你或 AI 重复犯错？如果是，先回到阶段 3.3；spec 写入应包含在本任务的提交批次中，不能遗忘到后续。

由 AI 批量提交本任务的代码变更，使 `/finish-work` 能在之后干净运行。目标是先生成工作提交，再生成归档和日志等记账提交；两者不得交错。

**步骤**：

1. **检查脏状态**：
   ```bash
   git status --porcelain
   ```
   记录所有脏路径。如果工作树干净，跳到 3.5。

2. **从近期历史了解提交风格**（使拟定消息保持一致）：
   ```bash
   git log --oneline -5
   ```
   记录前缀约定（`feat:` / `fix:` / `chore:` / `docs:` 等）、语言（中文/English）和长度风格。

3. **将脏文件分为两组**：
   - **本会话由 AI 编辑**——本会话通过 Edit/Write/Bash 工具调用写入或编辑的文件。你知道它们改了什么以及为什么改。
   - **未识别**——本会话没有触碰的脏文件（可能是用户手动编辑、之前会话遗留的 WIP 或无关工作）。不要静默纳入。

4. **起草提交计划**。将 AI 编辑的文件按逻辑提交分组（每个连贯变更单元一个提交，而不是每个文件一个提交）。每项包含 `<commit message>` 和文件列表；将未识别文件单独列在末尾。

5. **展示一次计划并一次性请求确认**。格式：
   ```
   Proposed commits (in order):
     1. <message>
        - <file>
        - <file>
     2. <message>
        - <file>

   Unrecognized dirty files (NOT in any commit — confirm include/exclude):
     - <file>
     - <file>

   Reply 'ok' / '行' to execute. Reply with edits, or '我自己来' / 'manual' to abort.
   ```

6. **获得确认后**：按顺序对每个批次运行 `git add <files>` + `git commit -m "<msg>"`。不要 amend，不要 push。

7. **遭到拒绝时**（用户回复“不行”/“我自己来”/“manual”或对计划提出任何反对）：停止，不要再尝试第二个计划。用户会手动提交；用户确认后跳到 3.5。

**规则**：
- 任何位置都不得使用 `git commit --amend`——采用三阶段三提交流程（工作提交 → 归档提交 → 日志提交）。
- 此步骤绝不 push 到远程。
- 用户接受文件分组但希望调整消息措辞时，修改消息并重新确认一次；如果拒绝分组，退出到手动模式。
- 批量计划只使用一个提问，不要逐提交提问。

#### 3.5 收尾提醒（Wrap-up reminder）

完成以上步骤后，提醒用户可以运行 `/finish-work` 收尾（归档任务、记录会话）。

---

## 自定义 Trellis（适用于 fork）

本节面向需要修改 Trellis 工作流本身的开发者。所有自定义都通过编辑本文件完成；脚本只负责解析。

### 修改步骤含义

编辑上方阶段一/二/三中对应步骤的说明正文。关键不变量：
- 没有活动任务时先分类；只有边界清晰、涉及单一表面且可立即验证的直接小任务可以继续，否则先创建 Trellis 任务。
- 规划必须区分 direct 短路径和 planned 完整方案路径；planned 在审查前必须具备详细有序实施步骤及唯一停止点。
- 每条必需执行路径都必须在 `/trellis:finish-work` 前保留可达的阶段 3.4 提交提醒。

所有标签块位于上方 `## Phase Index` 区域中，紧跟各阶段摘要之后：

| 范围（Scope） | 对应标签（Corresponding tag） |
|---|---|
| 没有活动任务（阶段一之前） | `[workflow-state:no_task]`（阶段索引图之后） |
| 一个开发者所属任务没有会话绑定 | `[workflow-state:unbound_task]`（生命周期写入前绑定） |
| 多个开发者所属任务没有会话绑定 | `[workflow-state:unbound_ambiguous]` / `[workflow-state:unbound_ambiguous-inline]`（明确选择并绑定） |
| 活动任务记录不可读 | `[workflow-state:task_error]`（继续前修复已有任务） |
| 整个阶段一（创建任务 → 实施就绪） | `[workflow-state:planning]`（阶段一摘要之后） |
| Codex inline 阶段一 | `[workflow-state:planning-inline]` |
| 阶段二 + 阶段 3.2–3.4（实施 + 检查 + 收尾） | `[workflow-state:in_progress]`（阶段二摘要之后） |
| Codex inline 阶段二 + 阶段 3.2–3.4 | `[workflow-state:in_progress-inline]` |
| 阶段 3.5 之后（已归档） | `[workflow-state:completed]`（阶段三摘要之后；**目前不可达**） |

### 修改每轮提示文本

直接编辑对应 `[workflow-state:STATUS]` 块的正文。编辑后，模板维护者运行 `trellis update`，自定义项目重启 AI 会话；不需要修改脚本。

### 添加自定义状态

添加新块：

```
[workflow-state:my-status]
your per-turn prompt text
[/workflow-state:my-status]
```

约束：
- STATUS 字符集：`[A-Za-z0-9_-]+`（允许下划线和连字符，例如 `in-review`、`blocked-by-team`）
- 生命周期 Hook 必须将 `task.json.status` 写为自定义值，否则标签不会被读取
- 生命周期 Hook 位于 `task.json.hooks.after_*`，绑定到 `after_create / after_start / after_finish / after_archive` 之一

### 添加生命周期 Hook

在 `task.json` 中添加 `hooks` 字段：

```json
{
  "hooks": {
    "after_finish": [
      "your-script-or-command-here"
    ]
  }
}
```

支持的事件：`after_create / after_start / after_finish / after_archive`。注意 `after_finish` 不等于状态变化（它只清除活动任务指针）；“任务完成”通知应使用 `after_archive`。

### 完整合同

关于工作流状态机运行时合同、所有状态写入位置、伪状态（`no_task` / `stale_<source_type>`）、Hook 可达性矩阵及其他详细内容，参阅：

- `.trellis/spec/cli/backend/workflow-state-contract.md`——运行时合同、写入表和测试不变量
- `.trellis/scripts/inject-workflow-state.py`——实际解析器（只读取 workflow.md，没有内嵌正文）
