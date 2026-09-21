# 修复未绑定活动任务的工作流投影

## Goal

区分无当前会话 pointer 与无活动任务，避免唯一活动任务被 workflow hook 误导为 no_task

## Requirements

- `task.py current`、SessionStart/turn context 和 workflow hook 必须继续尊重已知 session 的严格隔离；不得借用 foreign pointer。
- 当没有可解析的 session identity、没有可用 session pointer、且当前 developer 恰有唯一一个 `planning`、`in_progress` 或 `review` task 时，提供只读的 `unbound` projection。
- `unbound` projection 只能帮助恢复上下文和阻止重复建 task；不得写 session pointer，不得让 `finish`、ownership 或 handoff 生命周期把它当作 direct session binding。
- 无 developer identity、候选 task 为零或多于一个、存在可解析 session identity，均继续返回 `none` 或现有精确 session 结果。
- Python 模板、Trellis dogfood copy、workflow breadcrumb 和 OpenCode JS context resolver 保持一致。

## Modification Boundary

- Actual target: `/home/penn/devel/codex-workflow-optimization/Trellis`.
- Expected files: `active_task.py` template/dogfood pair, shared workflow hook, workflow template/dogfood pair, OpenCode context resolver, regression tests, and this task artifacts.
- Explicitly out of scope: changing task JSON status, manually writing `.runtime/sessions`, changing CCH task aggregation, changing FastCtx, or weakening known-session isolation.

## Acceptance Criteria

- [ ] No identity + one assigned resumable task projects `Source: unbound` and the task path in `task.py current --source` without creating runtime state.
- [ ] No identity + zero/multiple assigned resumable tasks remains `Source: none`; known identity + missing/empty pointer never borrows a foreign task.
- [ ] Workflow hook emits `unbound_task` for the unique unbound projection and does not emit the task-creation `no_task` guidance.
- [ ] `task.py finish` and formal ownership operations still reject an unbound projection as a writable direct session.
- [ ] Python template/dogfood parity, OpenCode parity, focused regression tests, full CLI tests, lint/typecheck, and package build pass.
- [ ] Release evidence records the source commit, tag, Actions run, and installed version before the task is closed.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
