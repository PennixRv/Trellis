# Durable Codex Session Relations

## Goal and confirmed facts

Own BILL-02 in the root task 10-08-session-child-billing. Channel removal deletes the current relationship evidence; the worker reducer preserves sessionIds until that removal. The common session_bound writer is core appendEvent, re-exported to the CLI supervisor. Codex readiness currently becomes true before persistence completes.

The user explicitly excluded recovery of prior history on 2026-10-08. Guarantee exact cumulative membership after the new recorder activates; expose that boundary, never claim complete pre-upgrade history.

## Requirements

- Record only owned Channel/Codex bindings from exact create owner, spawned provider and bound session.
- Preserve relationships independently of channel/task/process cleanup; include descendants, isolate owners, deduplicate reused sessions and include distinct retry sessions.
- Persist before enabling a Codex turn; a failed write must stop the worker through the existing error path.
- Provide public read-only core and CLI queries; no caller reads internal events to reconstruct billing.
- Store minimal identity metadata only, with private permissions, locking, atomic replacement, schema validation and conflict/cycle rejection.

## Acceptance

Native query remains correct after terminal/kill/rm/prune/force recreation/restart, across projects and descendants. Concurrent duplicates converge; conflicting parent, self/cycle, corrupt store and permission/write failures fail explicitly. No turn starts before persistence succeeds. Packed core/CLI export the new query, versions match, quality and official release gates pass.

## Ownership and exclusions

Writer: this checkout, existing pennix/v0.7-beta branch. Root owns coordination only; the second checkout is a consumer. No prior-history recovery, new database/dependency/daemon, billing API, task scheduler, Marketplace change or altered unowned/non-Codex lifecycle.
