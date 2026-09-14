# Subnode lifecycle and OpenViking boundary remediation

## Goal

Make bounded Trellis subnode execution auditable and explicitly prevent OpenViking auto memory behavior in worker processes without adding a second lifecycle ledger.

## Requirements

- Keep one subnode bound to one immutable brief and one report path.
- Make the existing Channel worker lifecycle observable from spawn through terminal and report disposition, including recovery when a worker terminates without a report.
- Make the worker handle explicit in the brief and require it to match the subnode assignment id.
- Provide a durable read-only worker projection for coordinators and a create-once coordinator disposition record after terminal observation and independent checks.
- Expose only the generic worker environment propagation required to disable OpenViking auto capture and auto injection for subnodes; do not add OpenViking code or a second lifecycle database to Trellis.
- Preserve the existing live-worker guard and configure the subnode procedure to use a logical maximum of eight active assignments without changing the ordinary default budget.
- Keep workers read-only with respect to task facts, Git, lifecycle state, dispatch, and OpenViking.

## Acceptance Criteria

- [x] `channel spawn --agent subnode` automatically loads the role's validated environment file into the detached supervisor and provider process, disabling OpenViking automatic recall, capture, and fixed injection.
- [x] The subnode procedure records one assignment per worker, terminal/report-pending/recovery behavior, and the configurable eight-slot default.
- [x] A coordinator can query the durable worker projection, and a validated report can receive exactly one structured disposition after terminal observation.
- [x] Regression tests cover environment propagation, invalid input, worker-handle binding, worker projection output, create-once disposition, and existing worker-budget behavior.
- [x] Template and checked-in project artifact remain synchronized.
- [x] `pnpm lint`, `pnpm typecheck`, targeted tests, full tests, and GitNexus impact/change checks pass.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
