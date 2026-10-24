# Fixed Teammate Batches

## Preparation

The main agent creates one task-owned plan and one immutable brief per work
unit. The plan contains an ordered work list, a `plan_hash`, source digests,
acceptance criteria, provider/profile/model selections, protected targets, and
an explicit per-work retry budget. The brief path is canonical:

```text
.trellis/tasks/<task>/teammates/<batch>/<work>/brief.json
```

Each brief is immutable and includes these validated fields (optional profile,
model, context files, and context manifests appear only when selected):

```json
{
  "schema_version": 1,
  "task_id": "<task-id>",
  "batch_id": "<batch-id>",
  "work_id": "<work-id>",
  "role_id": "teammate",
  "provider": "codex",
  "summary": "<short objective and expected result>",
  "scope": "<bounded work scope>",
  "lens": "<investigation or review lens>",
  "deadline": "<ISO-8601 timestamp>",
  "source_digest": "<sha256>",
  "acceptance": ["<acceptance criterion>"]
}
```

The coordinator creates `queue.json` beside the brief and
`attempts/<attempt-id>/claim.json` before dispatch. The assigned teammate
appends `attempts/<attempt-id>/worklog.md` and creates one
`attempts/<attempt-id>/report.json`; the coordinator alone writes
`attempts/<attempt-id>/disposition.json` after terminal and report validation.

The report is UTF-8 JSON with this shape; `evidence` must contain at least one
item, and the program accepts it only after matching the attempt identity,
source digest, and terminal event:

```json
{
  "schema_version": 1,
  "task_id": "<task-id>",
  "batch_id": "<batch-id>",
  "work_id": "<work-id>",
  "attempt_id": "<attempt-id>",
  "teammate_id": "<teammate-id>",
  "status": "complete",
  "source_digest": "<sha256>",
  "evidence": [
    {
      "id": "<evidence-id>",
      "locator": "<path or symbol>",
      "summary": "<finding>"
    }
  ]
}
```

The role is always `teammate`. The role card gives behavioral instructions;
host capabilities enforce protected-source and Git read-only access and limit
writes to the current attempt artifacts.

## Submission and Program Ownership

After the frozen plan is submitted to the Channel program, the main agent waits
for one terminal receipt. The program owns all dispatch and completion handling:

- fill logical slots in plan order;
- refill a released slot with the oldest queued unit;
- ask the same attempt to continue after a timeout;
- create a new attempt only after a confirmed failure and only within that unit's
  `max_retries`;
- validate identity, source digest, report status, and evidence;
- preserve protected leases while work or a continuation is unresolved;
- record `ALL_ACCEPTED`, `SETTLED_WITH_FAILURE`, or
  `RECONCILIATION_REQUIRED`.

The main agent does not inspect an individual report, choose a retry, split the
plan, or change provider/model selection during this run. A reconciliation
receipt is a control outcome and is not a business result.

## Provider Boundary

The provider tuple is `role + provider + optional profile/model/options`.
Codex app-server, DSH ACP, Copilot ACP, and Claude Code CLI are separate
adapter targets. Each adapter must prove foreground waiting, protected artifact
writes, disabled native delegation, isolation from implicit host memory, a
supported transport, and a positive verified capacity before dispatch. Only
context frozen in the brief may be injected. The role card repeats this as
behavior guidance; the host capability proof is authoritative. The current
source includes contract fixtures only; the user-facing batch command refuses
until a real host adapter supplies that proof.

## Failure Handling

The program distinguishes these cases:

1. A timeout keeps the same attempt and sends one continuation command. It does
   not consume the work unit's complete-retry budget.
2. A confirmed execution or acceptance failure ends the current attempt. If the
   budget remains, the program creates a new attempt identity in the same slot.
3. An unknown command or wait outcome enters reconciliation. It does not trigger
   an automatic duplicate dispatch.

Reports are written under the assigned attempt directory and are accepted only
after identity, source digest, terminal status, evidence, path, secret, and
symlink checks pass. A teammate never creates another teammate and never
performs a self-retry.
