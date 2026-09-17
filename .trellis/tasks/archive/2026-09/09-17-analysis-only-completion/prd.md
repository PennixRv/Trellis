# Analysis-Only Task Completion Route

## Goal

Allow an explicitly classified `analysis_only` task to deliver research, audit, or design evidence without entering the change-bearing implementation path.

## Requirements

- Keep task-creation consent. It authorizes the task record and, for this mode only, the bounded analysis delivery described in the PRD; it never authorizes product changes.
- Classify the mode explicitly as `task.json.meta.delivery_mode = "analysis_only"`; never infer it from a task title or keywords.
- Require the PRD to name the report/evidence deliverable and state that source code, runtime configuration, deployment state, credentials, and external systems are out of scope.
- Keep `status=planning`; do not call `task.py start`, add a lifecycle status, or change task scripts. Analysis task artifacts, research reports, commits, and archive records remain permitted writes.
- If analysis identifies a protected-target change, record the evidence and recommendation, then stop or create a separate change-bearing task. Do not implement the change in the analysis task.
- Teach workflow-state breadcrumbs and the start, brainstorm, continue, and finish-work entry templates the same route. Keep ordinary tasks on the existing planning review and `task.py start` gate.
- Add focused template regression assertions for classification, no-start behavior, direct archive route, and change-bearing-task exclusion.

## Acceptance Criteria

- [ ] The native workflow template defines the explicit mode, eligibility conditions, permitted and prohibited writes, direct completion route, and escalation rule.
- [ ] The planning and inline planning breadcrumbs tell an active `analysis_only` task to perform its evidence work rather than wait for implementation approval or `task.py start`.
- [ ] Generated start, brainstorm, continue, and finish-work entry templates apply the same mode without weakening the normal implementation gate.
- [ ] No task CLI, status writer, hook, or product/runtime behavior changes.
- [ ] Template tests demonstrate the route and retain the standard change-bearing guard.
- [ ] Relevant CLI tests, lint, typecheck, and format checks pass.

## Notes

- This task changes generic templates under `packages/cli/`; it does not modify the Trellis repository's own workflow policy.
