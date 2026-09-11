# CR 实施合同基线

**状态：** planning-only，未修改 Trellis 源码。

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
