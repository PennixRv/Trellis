# Issue 154：Python 子节点上下文投影一致性

## Goal

让 task.py validate 与共享 Python 子节点 Hook 使用同一完整投影判定，阻止会被截断、跳过或总预算降级的 implement/check 上下文通过校验；不改变 Pennix 正式 handoff 生命周期。

## Requirements

1. Add one pure Python context-projection evaluator under
   `.trellis/scripts/common/` and the byte-identical CLI template mirror. It must be the sole producer of
   `implement`/`check` context for `shared-hooks/inject-subagent-context.py` and the sole completeness source for
   `task.py validate`.
2. Preserve the Python Hook's ordered source contract: normalized `file`/legacy `path` JSONL entries, directory direct
   Markdown selection in lexical order (at most 20), then `prd.md`, `design.md`, and `implement.md`; preserve existing
   UTF-8-safe notice text, `0` means unlimited, and containment of repository root plus a symlinked `.trellis` root.
3. Make `task.py validate` return non-zero whenever a required Python-projection material is not complete body text:
   unreadable/escaped source, binary input, `max_file_bytes`, `max_artifact_bytes`, directory selection overflow or an
   empty directory, and `max_total_bytes` index degradation. The diagnostic must state the agent role, source category,
   path, and reason.
4. Keep invalid JSON, non-object rows, placeholders, seed-only manifests, and code-file hygiene behavior compatible;
   legacy `path` must be treated identically by parser, hook, validator, and list/count helpers.
5. Do not alter formal Pennix session-handoff creation, receipt validation, one-time consumption, compression recovery,
   OpenViking memory, or any independent Pi/OMP context renderer. The current Codex workflow invokes the shared Python
   Hook; Pi/OMP have distinct TypeScript contracts and are recorded as out of scope rather than falsely certified.

## Acceptance Criteria

- [x] The shared evaluator is used by both the Python Hook and `task.py validate`; template/runtime script parity passes.
- [x] Targeted integration tests prove failures for oversize `file` and legacy `path`, binary file, directory child
  truncation, directory selection above 20, oversize task artifact, and total-budget degradation; diagnostics expose
  role/category/path/reason.
- [x] Positive tests cover normal file/directory/artifact materialization and all three `0` unlimited settings; existing
  JSON and hygiene contracts remain intact.
- [x] `pnpm test -- context-injection-limits`, relevant regression tests, lint, typecheck, build, `git diff --check`, and
  template parity pass before release.
- [x] Release a patch version on `main`, push the tag, synchronize the Marketplace tag/version, update the installed
  Trellis workflow, and record fresh-host evidence before this component task and the coordinating root task archive.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
