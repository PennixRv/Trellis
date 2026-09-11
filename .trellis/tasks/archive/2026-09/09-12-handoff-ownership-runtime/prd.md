# Implement ownership-safe handoff runtime

## Goal

Implement the Trellis-owned session ownership transfer primitive required by the Pennix formal handoff migration: bounded ownership record, source retirement, successor claim, consume/archive lifecycle, generation/fencing, CAS, and regressions. Do not modify OpenViking or Plugin state.

## Requirements

- Add a Trellis-owned bounded ownership record binding `handoff_id` and `core_digest` to one task,
  source/consumer session identity, generation, and fencing token.
- Provide source `quiesce`/`retire`, successor `claim`, `consume`, post-consume `archive`, and read-only
  `status` operations without changing ordinary task lifecycle semantics.
- Require direct current session identity. Never infer ownership from a handoff prompt, OpenViking, a sole
  remaining session file, or `session-fallback`.
- Make mutations task/handoff scoped, atomic, and CAS-protected; retirement invalidates the old generation/token.
- Keep ownership runtime outside Git and reject unsafe paths, malformed records, oversized input, and secrets.

## Acceptance Criteria

- [x] Identity, context key, generation, fencing token, and handoff/core digest are distinct and validated.
- [x] `quiesce -> retire -> ready -> claim -> consume -> archive` transitions and invalid transitions are tested.
- [x] Source retirement prevents old-session writes; two simultaneous claims produce exactly one winner.
- [x] A target with identity but no current task does not inherit the source pointer; claim binds it natively.
- [x] Same-consumer claim/consume retry is idempotent; a different consumer cannot steal a claimed record.
- [x] Atomic writes, fsync/lock boundaries, digest validation, and Git exclusion are tested.
- [x] Dogfood/template parity, focused/full tests, lint, typecheck, Python checks, build, and release preflight pass.
- [x] No OpenViking source, Plugin private state, transcript, credential, or database is modified or committed.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
