# Bounded Subnode Work

Use a `subnode` only when the user explicitly needs independently reviewable
evidence for a bounded analysis, design, audit, review, counterargument, or
verification question. It is not the normal path for an ordinary static review,
implementation, memory retrieval, or routine tool call.

The coordinator owns task facts, protected targets, acceptance, Git, worker
lifecycle, and the final result. A subnode owns one evidence report and its own
append-only worklog. This is a behavioral contract; do not add `--sandbox` or
claim that path restrictions enforce it.

Keep credentials out of briefs, reports, worklogs and Channel messages. The artifact
validator rejects known private-key/token, Bearer and explicit credential-assignment
syntax; it does not recognize arbitrary secret values. Channel protocol messages keep
their original bytes for delivery in private local storage. Operator message views,
error/progress persistence and logs redact known credential syntax or omit raw worker
content; this is not general-purpose secret detection or private-path anonymization.

## Artifact Setup

Before spawning, the coordinator must use an active task (`planning` or
`in_progress`), define one stable `work_id` and
`subnode_id`, then prepare a brief-draft JSON with the question, independence
reason, scope, protected targets, lens, evidence method, source snapshot,
dependencies, stop conditions, deadline, and `channel_ref`. Set `retry_of`
only for an explicit manual retry and `counter_of` only for intentional
counterwork. A retry names an existing, different subnode in the same task and
`work_id`; counterwork may be initialized independently. The helper supplies
the immutable task identity and report path. New units also require `unit_plan`:

```json
{
  "unit_plan": {
    "plan_ref": ".trellis/tasks/09-07-example/design.md#evidence-units",
    "sizing_rationale": "One bounded dependency inspection with a separately reviewable result."
  }
}
```

The reference must identify an existing regular Markdown document inside this
task. For multiple scope items, add `grouping_rationale` explaining why every
item is quick/simple, obviously related, and uses shared context while retaining
separate conclusions. Record the actual scope mapping and evidence in the task
plan before initializing briefs; owner domains and slot counts do not determine
unit counts. Complex or lengthy points need separate units or further splitting.
The helper checks structure, not the truth of the sizing judgment. Historical
brief/report readers remain compatible; new init and queue admission require
the unit plan.

```bash
TASK=.trellis/tasks/09-07-example
WORK_ID=security-audit
SUBNODE_ID=dependency-evidence

python3 .trellis/scripts/subnode_artifact.py init \
  --task "$TASK" \
  --work-id "$WORK_ID" \
  --subnode-id "$SUBNODE_ID" \
  --draft /tmp/subnode-brief.json
```

This creates exactly:

```text
$TASK/subnodes/$WORK_ID/$SUBNODE_ID/
  brief.json     # coordinator-owned and immutable after dispatch
  worklog.md     # subnode appends material progress and corrections
  report.json    # subnode-owned final pending-review result
  disposition.json # coordinator-owned, create-once result decision
```

Do not use a Channel command or message body as the report transport. The
subnode's short final assistant reply names the already-written `report.json`
and its status; the Codex supervisor projects that reply into the durable
Channel message and `done` events. The durable JSON file carries the
reviewable result.

The subnode copies identity, scope, and lens from `brief.json`. Schema version 2
requires one `scope_assessment` entry for every brief scope item, structured
findings with evidence references, and typed uncertainties or corrections when
present. Schema version 1 is retired and the validator rejects it. The minimal
complete report is:

```json
{
  "schema_version": 2,
  "task_id": "task-id-from-brief",
  "work_id": "work-id-from-brief",
  "subnode_id": "subnode-id-from-brief",
  "role_id": "subnode",
  "status": "complete",
  "scope": ["exact scope copied from brief"],
  "lens": "exact lens copied from brief",
  "scope_assessment": [
    {
      "scope": "exact scope item from brief",
      "status": "covered",
      "conclusion": "What this scope establishes.",
      "evidence_ids": ["stable-evidence-id"]
    }
  ],
  "evidence": [
    {
      "id": "stable-evidence-id",
      "locator": "source path, URL, or command receipt",
      "summary": "What this independently reviewable evidence establishes."
    }
  ],
  "findings": [
    {
      "id": "finding-id",
      "conclusion": "Bounded conclusion.",
      "evidence_ids": ["stable-evidence-id"]
    }
  ],
  "uncertainties": [],
  "corrections": []
}
```

Append a checkpoint marker to `worklog.md` when a material unit is complete or
blocked. It is a bounded recovery projection, not coordinator acceptance:

```text
<!-- trellis-checkpoint: {"id":"checkpoint-1","covered_scope":["exact scope item"],"evidence_ids":["stable-evidence-id"],"conclusion_or_blocker":"Current conclusion or blocker.","unknowns":[],"safe_resume_point":"Next safe action."} -->
```

The validator returns `review_concern` for missing or incomplete checkpoint
coverage and for inconclusive scope assessments so the coordinator can inspect
them. Identity, schema, path, and malformed-structure failures remain hard
errors. A concern is never automatic acceptance or rejection.

For `blocked`, `incomplete`, or `error`, include the same base fields plus a
`completed_scope` list (empty when no assigned scope started) and a non-empty
`blocker` string. Never use
`accepted`, `rejected`, or `deferred` as a report status.

## Dispatch And Wait

Inspect the installed role first, then capture a durable event barrier before
the worker can emit a terminal event. The CLI waits once for a worker lifecycle
transition after that barrier, including supervisor-authored terminal events:

```bash
trellis channel create subnode-example
BARRIER="$(trellis channel barrier subnode-example)"
trellis channel spawn subnode-example --agent subnode --as "$SUBNODE_ID"

printf '%s\n' "Read $TASK/subnodes/$WORK_ID/$SUBNODE_ID/brief.json and perform only that bounded work." \
  | trellis channel send subnode-example --to "$SUBNODE_ID" \
      --stdin --delivery-mode requireRunningWorker

trellis channel wait subnode-example --workers "$SUBNODE_ID" \
  --after-seq "$BARRIER" --timeout 30m
```

When selecting a configured model profile, use `--profile <id>` in place of `--agent subnode`; it implies the subnode role and reads its Codex provider from role frontmatter. Keep the unique worker `--as` for dispatch identity. Omit author `--as` on `send` and `wait` to use `TRELLIS_CHANNEL_AS` or `main`.

`channel.subnode` in `.trellis/config.yaml` supplies the role defaults for
`max_live_workers` (generated default `8`), `idle_timeout`, `timeout`, and
`warn_before`. Change that section before a dispatch group when its resource
or lifetime needs differ; pass the corresponding `spawn` flag only for a
one-off override. The generic `channel.worker_guard` remains the fallback for
ordinary workers and for a subnode key omitted from the project config.

For rolling FIFO dispatch, follow `references/multi-target-dispatch.md`: initially
fill available native capacity, wait for the first terminal worker, review and
accept it, then refill while other workers continue. Do not use `--all` as an
ordinary refill prerequisite. Use `--workers a,b --all` only when the intent
requires draining all already dispatched workers, with the barrier captured
before dispatch.
Worker mode emits one terminal worker projection per satisfied target. Ordinary
adapter errors and peer turn completion do not end the wait. `--from` remains
an exact event-author filter; it is not a worker lifecycle selector.

Where the host exposes a live wait continuation, capture the same barrier,
establish one worker waiter before triggering the worker, and continue that same
waiter until terminal state. Until it resolves, times out, or errors, the next
host operation is only that continuation: do not create another waiter or run
shell/CLI diagnostics, including `channel messages`, worker inspection, or
status/list commands. Do not treat an empty transport slice as completion.
After the waiter returns, use those commands only for an on-demand diagnosis,
not as a high-frequency supervision loop.

## Coordinator Review

After the subnode's final reply, independently validate and then record a
task-level disposition. `complete` means only that the subnode claims it
completed its assigned work; it is not acceptance. Confirm the terminal state
from the durable worker projection; a report without a terminal worker is
still pending, and a terminal worker without a valid report is recovery.

```bash
REPORT="$TASK/subnodes/$WORK_ID/$SUBNODE_ID/report.json"
python3 .trellis/scripts/subnode_artifact.py validate --report "$REPORT"
trellis channel workers subnode-example --include-terminal --json
```

The coordinator must re-check enough source evidence and protected-target state
to decide `accepted`, `rejected`, or `deferred`. Record the terminal lifecycle
and sequence returned by `channel workers`, then let the helper create the
disposition exactly once:

```bash
python3 .trellis/scripts/subnode_artifact.py disposition \
  --report "$REPORT" \
  --outcome accepted \
  --terminal-lifecycle done \
  --terminal-seq 17 \
  --terminal-at 2026-09-14T03:00:00Z \
  --check report_validation \
  --check source_recheck \
  --check protected_target_check \
  --reason "Evidence and protected targets were independently rechecked."
```

`disposition.json` is coordinator-owned and cannot be replaced. The helper
does not inspect the Channel store or make the acceptance judgment; the
terminal values must come from the worker projection and the reason records
the coordinator's decision.

Use the separate coordinator work-record helper only for a durable cross-task
observation, decision, open question, or blocker. It does not substitute for a
task artifact or subnode worklog.

```bash
python3 .trellis/scripts/workspace_note.py \
  --kind decision \
  --summary "Accepted independent dependency evidence for the release gate." \
  --source "$REPORT"
```

## Counterwork

Counterwork is a new, independently scoped subnode, not a retry. It must use a
different `subnode_id`, lens, and evidence identities, and its brief sets
`counter_of` to the primary subnode ID. After both reports are complete:

```bash
python3 .trellis/scripts/subnode_artifact.py validate-counter \
  --primary "$TASK/subnodes/$WORK_ID/primary" \
  --counter "$TASK/subnodes/$WORK_ID/counter"
```

The coordinator compares the two reports and retains the comparison as part of
its own disposition.

## Manual Retry

A retry is a fresh, explicitly approved subnode after a recorded failed or
incomplete attempt. It uses a new `subnode_id`, preserves the old artifacts,
and sets `retry_of` to that prior subnode ID in its brief. The coordinator must
record why it is retrying and check the new report independently; neither the
helper nor Channel decides when to retry.

No scheduler, high-frequency polling loop, automatic retry, worktree, global
ledger, or provider-specific transport is introduced by this workflow. A
manual retry always uses a new subnode id and worker handle.
