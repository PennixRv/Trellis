# Codex Inline Default Restoration (2026-09-07)

## Evidence

Commit `4edfa660 feat(codex): enable native subagent dispatch (#445)` changed
the Codex default from inline to auto/native sub-agent dispatch across the
config parser, phase renderer, hook breadcrumb resolver, and configuration
comments. The current source still has tests and historical contracts stating
that Codex defaults to inline, including the task-create behavior that omits
JSONL manifests unless native dispatch is explicitly selected.

The auto default also conflicts with the approved Codex workflow architecture:
the main session is the default implementation path, and Channel `subnode`
work is an explicit, independently valuable evidence operation rather than an
automatic implementation-worker replacement.

## Decision

Restore `inline` as the default in this fork. Keep `auto` and the legacy
`sub-agent` alias as explicit opt-in values for users who deliberately choose
native Trellis agents. Update all three behavior paths together:

- task creation's JSONL-manifest decision;
- `get_context.py --platform codex` phase routing;
- Codex per-turn breadcrumb and mode banner.

This avoids a custom marketplace workflow metadata mechanism. A selected
Codex subnode workflow will naturally route to inline behavior under the
restored default, while an explicit project configuration can still select
native dispatch.
