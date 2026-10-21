# Implement closed-plan workflow state machine

## Goal

Implement Trellis-owned planning stages, complete-plan validation, approval guards, a single planning entry route, and a safe migration interface on `pennix/v0.7-beta`.

## Requirements

- Persist the planning stage, revision, seal, and approval under `task.json.meta.planning`; do not add a second stage file or Hook-owned state.
- Keep `task.status` as the task lifecycle axis. Define and enforce its relationship to the planning stage for create, start, replan, archive, resume, and already-active tasks.
- Implement only the approved paths for planned/change-bearing, task-based direct, taskless direct, and analysis-only work. Keep administrative abandonment distinct from `plan_closed` and implementation completion.
- Require structured, complete planning material before a change-bearing plan can enter review: resolved decisions, ordered implementation steps and dependencies, repository/branch ownership, verification, risk/rollback, and one explicit stop point.
- Bind the displayed material digest, seal, approval, and start to the same task revision. Material changes invalidate the previous seal and approval.
- After `plan_closed`, let the planning Skill model assess new requests, changed conditions, and implementation discoveries against the approved plan. Only changes that preserve every approved commitment and remain executable under the existing plan are minor: append the assessment, affected step, delta, and verification to unsealed `execution.md`, keep the current status/stage, and continue. A changed goal/scope/acceptance, reopened decision, changed owner/repository/branch/component, design or public/data/security/privacy/release contract, dependency, verification, risk/rollback, stop point, invalidated assumption, or unresolved impact is major: stop dependent implementation and use native replan to the earliest affected stage. The CLI enforces state and receipt mechanics; it does not classify impact.
- First determine whether each new user request belongs to the active task. An independent deliverable gets its own task at `intake` and does not alter an unrelated active task; if bounded context cannot establish the relationship, leave the current task unchanged and clarify with the user. A changed outcome, scope, or acceptance for the current task follows the major replan path even when the requested delta is small.
- Archived or completed tasks remain terminal; a later follow-up starts a new task rather than using replan to reopen a terminal task.
- Permit native replan from both `status=planning, stage=plan_closed` and `status=in_progress, stage=plan_closed`; record source status/stage and target stage, increment the revision, clear prior seal/approval, and require full review and explicit user approval before restarting. `execution.md` remains outside the sealed plan digest.
- Preserve existing replan for all `in_progress` tasks, including legacy tasks with no recorded stage and direct tasks that outgrow their bounded scope; re-enter planning at the explicit target without inventing prior plan content or approval.
- For a task started through `direct_ready`, use its accepted single-change, owner, verification, and rollback contract as the execution baseline. A minor delta must still satisfy every direct eligibility condition; if it exceeds that boundary, replan to `intake` and reclassify before continuing.
- Provide a bounded native migration command with dry-run, apply, per-task receipts, source-digest checks, and conditional rollback. Migration must preserve existing evidence and must never invent a stage or user approval for an already `in_progress` task.
- Replace the generated `trellis-brainstorm` planning entry with `trellis-idea-to-closed-plan`; update its Trellis callers and generated-asset migration so modified or unowned files are preserved.
- Remove Trellis's duplicate Marketplace submodule only after the root cross-repository gate covers its contract checks; retain `docs-site` and stop CI/publish from initializing Marketplace.
- Keep `.trellis/scripts/**/*.py` byte-identical to `packages/cli/src/templates/trellis/scripts/**/*.py`.

## Acceptance Criteria

- [ ] The state contract lists every allowed transition, rejected transition, lifecycle/status invariant, persistence field, native writer, and resume behavior.
- [ ] CLI tests cover planned, direct, analysis-only, replan, archive, material drift, migration dry-run/apply/conflict/rollback, and invalid edges without partial writes.
- [ ] CLI tests cover major replan from both `plan_closed` lifecycle states, preserve replan for legacy/direct `in_progress`, reject unsupported planning source states/targets and terminal archived/completed tasks, log source/target state, invalidate old approval, and keep execution-ledger additions outside the sealed digest; Skill/workflow checks cover independent requests leaving unrelated tasks unchanged, ambiguous task relationship requiring clarification without mutation, small requests that change approved scope still taking the major path, planned and direct minor continuation versus major replan and reapproval/reclassification, and follow-ups creating new tasks after terminal completion.
- [ ] All Trellis planning callers use one entry name and read stage through native status/context output; Hooks do not write planning state.
- [ ] Old generated planning files are deleted only when their ownership hash matches; user-modified and untracked files are retained and reported.
- [ ] Marketplace is absent from Trellis `.gitmodules`, the nested worktree and module store; `docs-site` remains available and CI/publish initialize only required submodules.
- [ ] Trellis unit, integration, template, type, lint, and Python checks pass; the two Python script trees are byte-identical.
- [ ] The frozen 21-task baseline remains unchanged until the approved one-time migration is applied by the native command.

## Scope Boundary

This task owns Trellis source, its tests/specs/templates/hooks, the 21-task migration interface, and removal of Trellis's nested Marketplace checkout. The root coordinator owns cross-repository fixtures, root generated assets, final integration, and root gitlinks. The Marketplace owner task owns Marketplace workflow documents and `index.json`. No publishing, pushing, or merging is included.

<!-- trellis-decisions:v1 -->
```json
{
  "schema_version": 1,
  "decisions": [
    {
      "id": "post-closure-impact-owner",
      "status": "decided",
      "question": "Who determines whether a post-closure change is minor or major?",
      "evidence": ["prd.md#Requirements", "design.md#Post-closure change triage", "User clarification recorded in the root coordinator task"],
      "answer_or_reason": "The planning Skill model compares the change with the approved plan and applies explicit criteria. The Trellis CLI validates lifecycle transitions and receipts but does not duplicate semantic classification.",
      "impact": "Minor/major classification has one semantic owner, while the CLI remains the only lifecycle-state writer.",
      "reopen_when": "Implementation evidence shows the model criteria cannot distinguish a commitment-preserving delta from a change that requires renewed user approval."
    },
    {
      "id": "post-closure-change-paths",
      "status": "decided",
      "question": "What happens to minor and major changes after plan closure?",
      "evidence": ["prd.md#Requirements", "design.md#Post-closure change triage", "design.md#Native interface"],
      "answer_or_reason": "First route the request: an independent deliverable gets a separate task, an unclear relationship after bounded evidence is clarified without mutating the current task, and a terminal task stays closed. For a current-task change, minor preserves every approved commitment and is recorded in unsealed execution.md without a state transition; changing approved scope or acceptance is major even if the requested delta is small. A major or unbounded change stops dependent work, uses native replan to the earliest affected stage, invalidates old receipts, and requires a new reviewed plan and explicit approval.",
      "impact": "Small execution deltas do not churn lifecycle state; material changes cannot inherit stale approval.",
      "reopen_when": "A real workflow case cannot be represented by the minor ledger or the supported replan entry stages."
    }
  ]
}
```
