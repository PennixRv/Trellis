# Issue180 runtime projection compatibility migration

## Goal

修复上一轮 unbound_ambiguous 已进入模板但未进入现有 Pennix 定制项目 Hook 的升级路径；增加精确、幂等、保留定制的兼容迁移，补齐真实升级回归并发布。

## Requirements

- Existing Codex projects with the historical Pennix-managed workflow hook must receive the already-released `unbound_ambiguous` runtime projection when they run `trellis update`.
- The compatibility path must be content-precise and idempotent: it may update only the recognized historical Pennix hook shape, retain its dispatch-mode customization, and keep any other modified hook on the normal conflict path.
- The upgrade must use the normal update backup, write, and template-hash pipeline; it must not write during `--dry-run`.
- Ship a regression test for the upgrade path and retain the direct hook projection regression.

## Acceptance Criteria

- [ ] A recognized old Pennix Codex hook is classified for automatic update and receives the ambiguity projection without a `--force` override.
- [ ] An unrecognized modified hook remains a user-conflict and is not silently overwritten.
- [ ] A second update is a no-op and the upgraded file hash is tracked.
- [ ] The upgraded hook emits `unbound_ambiguous` with all candidate paths, rather than `no_task`, for two developer-owned active tasks.
- [ ] Focused and release quality checks pass; the CLI/core version pair is released from `main` and the local installation is updated.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
