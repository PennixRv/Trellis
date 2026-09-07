# Bounded Subnode Work

Use a `subnode` only when the user explicitly needs independently reviewable
evidence for a bounded analysis, design, audit, review, counterargument, or
verification question. It is not the normal path for an ordinary static review,
implementation, memory retrieval, or routine tool call.

The coordinator owns task facts, protected targets, acceptance, Git, worker
lifecycle, and the final result. A subnode owns one evidence report and its own
append-only worklog. This is a behavioral contract; do not add `--sandbox` or
claim that path restrictions enforce it.

## Artifact Setup

Before spawning, the coordinator must use an active task (`planning` or
`in_progress`), define one stable `work_id` and
`subnode_id`, then prepare a brief-draft JSON with the question, independence
reason, scope, protected targets, lens, evidence method, source snapshot,
dependencies, stop conditions, deadline, `channel_ref`, `retry_of` (null unless
this is an explicit manual retry), and `counter_of` (null unless this is
intentional counterwork). A retry names an existing, different subnode in the
same task and `work_id`; counterwork may be initialized independently. The
helper supplies the immutable task identity and report path.

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
```

Do not use a terminal Channel message as the report transport. The short final
message names the already-written `report.json` and its status; the durable
JSON file carries the reviewable result.

The subnode copies identity, scope, and lens from `brief.json`. The minimal
complete report is:

```json
{
  "schema_version": 1,
  "task_id": "task-id-from-brief",
  "work_id": "work-id-from-brief",
  "subnode_id": "subnode-id-from-brief",
  "role_id": "subnode",
  "status": "complete",
  "scope": ["exact scope copied from brief"],
  "lens": "exact lens copied from brief",
  "evidence": [
    {
      "id": "stable-evidence-id",
      "locator": "source path, URL, or command receipt",
      "summary": "What this independently reviewable evidence establishes."
    }
  ],
  "findings": ["Bounded conclusion."],
  "uncertainties": [],
  "corrections": []
}
```

For `blocked`, `incomplete`, or `error`, include the same base fields plus a
non-empty `completed_scope` list and a non-empty `blocker` string. Never use
`accepted`, `rejected`, or `deferred` as a report status.

## Dispatch And Wait

Inspect the installed role first, then capture a durable event barrier before
the worker can emit a terminal event. The CLI waits once and replays matching
events committed after that barrier:

```bash
trellis channel create subnode-example --by main --cwd "$PWD"
BARRIER="$(trellis channel barrier subnode-example)"
trellis channel spawn subnode-example --agent subnode --provider codex \
  --as "$SUBNODE_ID" --cwd "$PWD" --timeout 30m

printf '%s\n' "Read $TASK/subnodes/$WORK_ID/$SUBNODE_ID/brief.json and perform only that bounded work." \
  | trellis channel send subnode-example --as main --to "$SUBNODE_ID" \
      --stdin --delivery-mode requireRunningWorker

trellis channel wait subnode-example --as main --from "$SUBNODE_ID" \
  --kind done,error --after-seq "$BARRIER" --timeout 30m
```

Where the host exposes a live wait continuation, capture the same barrier,
establish one event waiter before triggering the worker, and continue that same
waiter until terminal state. Until it resolves, times out, or errors, the next
host operation is only that continuation: do not create another waiter or run
shell/CLI diagnostics, including `channel messages`, worker inspection, or
status/list commands. Do not treat an empty transport slice as completion.
After the waiter returns, use those commands only for an on-demand diagnosis,
not as a high-frequency supervision loop.

## Coordinator Review

After a terminal message, independently validate and then record a task-level
disposition. `complete` means only that the subnode claims it completed its
assigned work; it is not acceptance.

```bash
REPORT="$TASK/subnodes/$WORK_ID/$SUBNODE_ID/report.json"
python3 .trellis/scripts/subnode_artifact.py validate --report "$REPORT"
```

The coordinator must re-check enough source evidence and protected-target state
to decide `accepted`, `rejected`, or `deferred`, preserving the reason and named
checks such as `report_validation`, `source_recheck`, and
`protected_target_check` in task research or a decision record. The validator
does not make that decision and does not modify `task.json`.

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
ledger, or provider-specific transport is introduced by this workflow.
