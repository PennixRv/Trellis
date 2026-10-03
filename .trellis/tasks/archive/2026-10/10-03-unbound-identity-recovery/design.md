# Identity and binding remain separate

Planning Seal: closed, 2026-10-03. Branch fix/unbound-identity-recovery; base pennix/v0.7-beta; release 0.7.0-beta.25. Full user authorization is recorded.

Pass resolved identity into the existing unbound helper; retain unbound source_type and read-only projection. Existing current JSON session_source then reports identity without adding an API field.

Ownership _direct_context normalizes candidates into an empty direct-task view with validated identity. Retirement's post-clear checks reuse that view. quiesce/consume/archive still require a direct current task; clear_active_task clears only session bindings. Fencing and existing record validation remain intact.

Common continue and native/codex-subnode-channel breadcrumbs inspect current --json, select by explicit intent and route planning before start. Eligible analysis_only remains unstarted. OpenCode JS has no identity-bearing result or ownership consumer; its candidate/state semantics remain unchanged.

Targets: active_task.py/ownership_record.py script twins; common/commands/continue.md; native template/dogfood/Marketplace and codex-subnode-channel Marketplace; index digests; existing regression/ownership tests; workflow-state spec. Release adds beta.25 manifest, paired docs changelog/navigation and native version bump.

Graph impact is CRITICAL for resolver/ownership: task pointer, identity, continuity and handoff consumers are reviewed and tested. No new dependency, abstraction, auto-binding, provider change or bind-only API. Roll back through scoped revert or previous pinned deployment. Safety failure/material expansion returns to planning.
