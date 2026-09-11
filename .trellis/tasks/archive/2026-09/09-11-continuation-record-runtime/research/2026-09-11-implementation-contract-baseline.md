# CR 实施合同基线

**状态：** 已实现并完成组件级验证；未修改 OpenViking、Plugin、NAS 或宿主 runtime。

- `packages/cli/src/templates/trellis/index.ts` 是脚本模板注册单点；新 `.py` 必须同时 export 与进入
  `getAllScripts()`，否则 `trellis update` 不会传播。
- `common/active_task.py` 是 active-task resolver 的权威 Python 实现；当前已复现一个 session
  isolation defect：已解析当前 context key 但该 key 无 pointer 时仍会进入 single-session fallback，
  继承 foreign pointer。源码与 `packages/cli/src/templates/trellis/scripts/common/active_task.py` 必须
  同步修复为“仅 context key 缺失才 fallback”。
- `.opencode/lib/trellis-context.js` 与
  `packages/cli/src/templates/opencode/lib/trellis-context.js` 有同构 resolver，必须同步改为已知
  session id 不 fallback；`.opencode` dogfood 与模板均为 tracked 文件。
- 现有 `[session-fallback]` TypeScript regression 已覆盖 zero/multiple/no-identity/exact-match，
  但缺“known target key + sole foreign pointer”。还必须把旧的 `finish removes the sole fallback
  session file` 改为 foreign pointer 不被 target finish 清除，并新增真实 workflow-state hook
  不注入 foreign planning task 的集成回归。
- `task.py` 持有 task CLI parser/dispatcher；`session_context.py` 是已有 JSON/text projection 层；应复用
  而非增加第二套 context generator。
- GitNexus 当前报告索引 stale；实际源码编辑前需在 Trellis repo 按正确参数重新 `impact`/`detect-changes`。
- 本基线不证明 OpenViking archive、Task API、session mapping 或 convergence；它们不是 CR 的输入或保证。
- session-isolation 修复已完成并发布：`v0.6.25` / `24ee1ee717656ced304574562d08b3ea767161c3`，
  Marketplace 已同步 `v0.6.25`，宿主 CLI/Core 已安装同版。CR 实现必须沿用该 resolver 边界；
  handoff 的 rollout `session_id` 仍只属于来源 provenance，不能替代 target 的直接
  `session:<target-key>` 绑定证据。

## 已落地与验证

- `common/continuation_record.py` 提供唯一 CR decoder、source projection、每 task advisory-lock CAS
  writer、atomic seal、fsynced clear 和 readonly `absent|ready|stale|withheld` status；只接受直接解析的
  当前 task、Git snapshot 和 bounded project-relative evidence。
- 已知 session context 没有自身 pointer 时返回无当前 task；`session-fallback:<key>` 被 withheld，不能
  成为 handoff target。`task.py continuity`、`session_context.py` 只读接入，不改变 task status、pointer
  或 archive 语义。
- dogfood/template 三个关键脚本字节一致；新模块已在 `index.ts` 注册，更新传播继续使用既有 hash/conflict
  保护。CR runtime 被排除出自身 Git source digest，避免记录自己造成假 stale。
- `pnpm --filter @pennixrv/trellis exec vitest run test/continuity.test.ts --reporter=verbose`：4 passed，
  覆盖 direct pointer、foreign-pointer isolation、fallback withholding、并发 seal/CAS 和 symlink request。
- `pnpm test`：core 377 passed / 1 skipped；完整 CLI suite passed（含 continuity tests）。
- `pnpm lint`、`pnpm typecheck`、目标 Python `py_compile` 均通过；`lint:py` 为 0 errors、68 个既有
  common re-export unused-import warnings，新 CR 文件无 warning；`git diff --check` 通过。
- 用户已明确免除严格 disposable fresh-init smoke，因此本轮未单独执行该 smoke；既有 template/update integration
  tests 和 CR fixture 已覆盖模板发出与使用路径。
