# Governed Channel Skill Routing Design

## Scope and ownership

The source of truth is `packages/cli/src/templates/common/bundled-skills/trellis-channel/`. The CLI already discovers and copies this directory to every platform skill root, so the fix stays in the shared skill and does not add platform-specific routing code.

## Routing contract

Before selecting a pattern, the skill instructs the AI to inspect `.trellis/codex-workflow.json`:

```text
governed =
  distribution.profile == "codex-only-analysis-channel"
  && dispatch.backend == "trellis-channel"
  && dispatch.native_agents == "disabled"
  && dispatch.main_implementation_only == true
  && dispatch.worker_report_policy == "runtime-outbox"
```

When `governed` is true, the skill loads `codex-workflow-dispatch` and sends analysis/review work through that route. It does not select Pattern B or spawn an implement/check worker directly. The main session retains implementation, task facts, acceptance decisions, and Git.

When `governed` is false, the skill keeps the existing channel patterns, including direct implement/check examples. Missing or malformed profile data is not treated as proof of governed mode and does not silently change ordinary Trellis behavior.

## Distribution and tests

The test reads the bundled source and resolves it through `resolveBundledSkills()` for every registered platform context. It asserts the guard and Pattern B boundary survive rendering and that the ordinary examples remain available. Existing configurator tests continue to cover init/update file-set parity.

## Compatibility and rollback

- This is prompt routing, not a new CLI flag or profile parser. Existing channel commands and event contracts remain unchanged.
- A future profile schema change must update the guard and its test together; partial predicates must not enable governed routing accidentally.
- Reverting the commit restores the previous skill text without changing task state, runtime data, or installed packages.
