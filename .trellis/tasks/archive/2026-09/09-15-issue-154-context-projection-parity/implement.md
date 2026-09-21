# Implementation Plan

1. Add `common/context_projection.py` to the live `.trellis/scripts/` tree and CLI template tree. Keep it standard
   library only and make its path resolution work for the task's archive self-reference contract.
2. Replace the Python Hook's local JSONL/materialization/budget implementation with a small runtime import of the
   evaluator, retaining public prompt assembly and Hook failure isolation.
3. Refactor `common/task_context.py` to consume the evaluator parser and completeness issues. Maintain legacy output for
   malformed JSON, placeholders, seed-only manifests, and code-file warnings while replacing only the old oversize
   warning with failure-closed completeness diagnostics.
4. Expand `context-injection-limits.integration.test.ts`; update any regression expectations whose prior contract was
   advisory truncation. Verify test fixtures assert both the Hook notice and CLI outcome.
5. Run targeted then package checks. Release only from clean `main`; update the Marketplace repository/tag to the same
   version, install the released workflow, and perform the coordinating root fresh-host checks.

## Completed Evidence

- Shared evaluator/runtime/template parity: `.trellis/scripts/common/context_projection.py` and
  `packages/cli/src/templates/trellis/scripts/common/context_projection.py` are byte-identical; the Python Hook and
  `task.py validate` both consume the evaluator.
- Verification: targeted projection/regression/template tests passed; full Trellis test suite passed with 91 files and
  1979 CLI tests; core suite passed with 20 files and 378 tests; lint, typecheck, BasedPyright, build, and `git diff
  --check` passed. BasedPyright reported only the pre-existing 68 unused-export warnings.
- Release: the first `v0.6.33` attempt correctly stopped in CI because the runtime `.trellis` mirror was excluded from
  the release snapshot. The mirror was committed as `8d22ba78`; corrected `v0.6.34` was released from `c5dc64fc`,
  published to both npm packages, and verified by the publish workflow after registry propagation.
- Marketplace: tags `v0.6.33` and `v0.6.34` point at the existing `8ff6829` Marketplace content; no version field exists
  in `index.json`, so no unrelated Marketplace content was fabricated.
- Installation and fresh-host acceptance: global `@pennixrv/trellis` and `@pennixrv/trellis-core` are both `0.6.34`,
  the coordinating project's stamped `.trellis/.version` is `0.6.34`, and `trellis update --skip-all` completed while
  preserving protected local assets. The current root Hook was then synchronized with the released template and is
  byte-identical to `packages/cli/src/templates/shared-hooks/inject-subagent-context.py`.
- Fresh temporary-project probe: a normal `file` entry and legacy `path` entry were fully projected by the installed
  Hook and `task.py validate` returned `0`; replacing the implement entry with a 40,000-byte file produced the
  expected truncation notice and a non-zero validator result containing `role=implement`, the source path, and the
  limit reason. This verifies the released behavior outside the source checkout.
- Boundary: formal Pennix handoff, OpenViking memory, and independent Pi/OMP renderers remain outside this Python
  projection task.
