# Multiple Evidence Units

Use after the user has authorized independent evidence and the task owns a
reviewed unit mapping. Read `subnode-work.md` for artifact and acceptance rules.
Codex inline mode governs native implement/check agents; it does not disable
explicit Channel evidence. Missing independent reports cannot be replaced by
main-session pass claims.

## Prepare And Dispatch In One Host Call

Choose units by work, complexity, evidence range, and relationship. Combine only
individually quick/simple and obviously related points with shared context and
a bounded total workload. Each scope item keeps its own evidence, conclusion,
unknowns, and stop condition. Neither eight slots nor eight owner domains imply
eight work packages. Store this mapping in the task's existing plan or matrix.

Read the actual native guard and current workers/reservations. Initially fill
all available capacity in FIFO order; a justified dependency or resource limit
belongs in the task record, not an arbitrary coordinator throttle. Initialize
all reviewed briefs before queue creation or spawning. A failed initialization
stops admission; preserve/reconcile partial artifacts without dispatching them.

For a configured subnode profile, `spawn --profile <id> --as <worker>` implies
the subnode role and inherits its Codex provider; do not repeat
`--agent subnode --provider codex`. Keep each worker ID and `send --to` explicit.
Read each unit's selected profile/model/effort from its brief and compare the
durable spawned receipt with that selection; never substitute one fixed profile
for a mixed-unit batch. Record a mismatch rather than inferring quality from a
profile name when the effective values are identical.
Author identity on `send` defaults to `TRELLIS_CHANNEL_AS` or `main`, so routine
dispatch need not repeat `--as main`.

Coalesce operations that can share one noninteractive host invocation. Use ONE
native `exec_command` containing a standard-library loop over existing CLI
commands. Multiple `exec_command` calls inside `functions.exec` still count as
multiple host calls. This is a procedure, not a new Channel batch API, scheduler,
or worker-state store. Keep init and dispatch as separate admission stages.

The following runnable pattern consumes a temporary, reviewed JSON array of
`{"target": "unit-id", "argv": ["trellis", "channel", ...]}` entries. Use
`[sys.executable, ".trellis/scripts/subnode_artifact.py", ...]` for artifact
commands. Put claim, spawn, and send in queue order; do not include waits. Review
each argument vector and the native capacity before executing. The input and
raw receipts are temporary command data, not task authority; retain only needed
non-sensitive evidence and clean the temporary input after use.

```bash
# python on Windows; python3 elsewhere. Execute this whole block in ONE host call.
python3 - /absolute/path/to/reviewed-actions.json <<'PY'
import json
import subprocess
import sys

actions = json.load(open(sys.argv[1], encoding="utf-8"))
failed = False
for action in actions:
    if failed:
        print(json.dumps({"target": action["target"], "status": "not_attempted"}))
        continue
    argv = [sys.executable if part == "{python}" else part for part in action["argv"]]
    try:
        result = subprocess.run(argv, capture_output=True, text=True, check=False)
        failed = result.returncode != 0
        receipt = {"target": action["target"], "argv": argv,
                   "status": "error" if failed else "completed",
                   "exit_code": result.returncode,
                   "stdout": result.stdout, "stderr": result.stderr}
    except OSError as error:
        failed = True
        receipt = {"target": action["target"], "argv": argv,
                   "status": "error", "error": str(error)}
    print(json.dumps(receipt), flush=True)
sys.exit(1 if failed else 0)
PY
```

The aggregate exit code is not per-target evidence. Inspect every receipt,
including missing or conflicting receipts; the first error stops later actions
and stops the remainder of this invocation. Reconcile completed, failed and
not-attempted targets before further admission; apply the local/global boundary
below rather than assuming every failure blocks unrelated units. Never replay a
claim or retry in its old worker conversation. A permitted fresh attempt needs a
new brief and ID with `retry_of`; old evidence is navigation only and must be
independently rechecked.

## Rolling FIFO

1. Capture a durable barrier before dispatch. Claim the earliest unclaimed unit,
   spawn/send through native Channel, and preserve its receipt. The helper
   enforces claim order; earlier claims need not be accepted to fill initial slots.
2. Reconcile the complete worker projection with claims and reports first.
   Process every already-terminal unit, including terminal siblings absent from
   an old active list. When no live work remains, enter review/closeout directly;
   zero live workers with an exhausted queue is valid and does not prove a stall.
   Establish exactly one native waiter for actual live workers without
   `--all`. Resume only its live host continuation until it returns, times out,
   or errors; run no other host action meanwhile.
3. Recheck dispatched items for failures, conflicts, and unresolved terminal
   states. Still-running healthy workers do not need to finish. Validate the
   completed worker's per-scope report, recheck sources and protected targets,
   then write its create-once `accepted` disposition.
4. That acceptance plus verified native capacity authorizes the next unclaimed
   FIFO unit immediately, while other healthy workers continue. Preserve the
   barrier/event cursor so already emitted terminal events cannot be lost.
5. Local report delivery/validation failures isolate that unit and provide no
   accepted-slot credit. Other independently accepted units refill FIFO normally;
   a retry does not reserve an exclusive time interval. Identity, source or
   protected-target, permission/security and capacity conflicts, missing terminal
   evidence, conflicting receipts and unresolvable reservations stop global
   admission. A terminal event alone never authorizes replacement. On recovery,
   reconstruct claims, events, workers/reservations, reports, and dispositions;
   never redispatch an old claim or require all healthy live predecessors to
   complete merely to refill an accepted slot.

A host continuation belongs to the single outstanding wait, not to a new worker
notification. Resume that continuation only; do not add a waiter, status poll,
background shell job or progress reaction while it remains live. After a real
return, process its event cursor and complete projection before choosing refill,
another authorized wait or closeout. Use diagnostics only for an actual error,
timeout, conflicting fact or explicit user request.

## Temporary Task Switch

Save the old task's checkpoint. Pause refills and drain ALL already dispatched
units: wait, validate, and disposition each result, including failures; confirm
the live continuation, worker, and reservation boundaries are closed. A drain
does not dispatch pending queue items or turn a failure into acceptance. Do not
automatically kill, retry, or abandon the old queue. Preserve unclaimed work and
the old phase. Only after drain, run native `task.py select <new-task>`; it
changes context without status, branch, after_start hooks, or implementation
authority. With no in-flight work, select directly after saving the checkpoint.

When returning, reconstruct only the missing old-task facts and resume only
still-authorized work. Selecting a user-stopped audit never restarts it. Ordinary
continue and sufficient compaction recovery retain their direct checkpoint path.
