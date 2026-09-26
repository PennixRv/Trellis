# Parallel workflow CLI contract

## Goal

Implement Pack A CLI contracts and F11 configurable subnode profiles; after G1, implement the bounded F12 queue contract.

## Requirements

- Preserve existing brief/report/disposition v2, Channel wait, guard, and provider policy contracts; only fix a confirmed defect.
- Add the managed project asset `.trellis/agents/subnode-profiles.json` through the existing Trellis init/update hash and conflict protection path.
- Resolve an explicitly selected profile only for `--agent subnode` + Codex. Apply `--model` > profile model > default model and `--reasoning-effort` > profile effort; reject unknown, invalid, untrusted, or provider-incompatible values before reservation.
- Add `--reasoning-effort-reason`; require it when the effective effort is `xhigh`; record resolved profile, model, effort, source/digest, and reason in the immutable spawned receipt without claiming provider-side adoption.
- Keep calls without `--profile` behavior-compatible; do not add worker identities, tool enforcement, a second state machine, a scheduler, or a main-window override bridge.
- After the root G1 receipt is accepted, add the bounded F12 queue helper to the existing artifact script: write-once manifest, FIFO claim, fail-closed validation/recovery, and one queue-abandoned marker; do not implement it before G1.

## Acceptance Criteria

- [ ] CLI profile positive/negative matrix and adapter request-shape checks pass.
- [ ] Init/update adds the template and preserves edited local profile content through conflict handling.
- [ ] Core receipt fields remain optional and old event consumers remain compatible.
- [ ] G1 is accepted before any F12 source write.
- [ ] F12 queue positive/negative/recovery checks pass and its result is recorded in the root task.
- [ ] Final full verification and release checks are run only after all owners finish.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
