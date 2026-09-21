<!-- TRELLIS:START -->
# Trellis

Follow `.trellis/workflow.md`; read the applicable `.trellis/spec/` guidance before editing code, and keep task facts in `.trellis/tasks/`. Project-scoped helpers live in `.agents/skills/`.

When a live Trellis Channel wait returns a host continuation, resume only that continuation until it resolves, times out, or errors. Do not run another host action meanwhile, including another wait, shell command, or status/message query; use diagnostics only on demand after it returns.

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->
