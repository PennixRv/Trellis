# Teammate processes

The coordinator creates a queue fact and an immutable claim for each
assignment, dispatches the selected provider, waits for a terminal host fact,
and validates the report against the assignment identity, source digest,
evidence, path, secret, and symlink rules. The teammate writes only its
current attempt artifacts. It does not modify product source, Git state, task
status, or another teammate's artifacts.

After a timeout, the same attempt may receive a continuation. A confirmed
execution or acceptance failure may consume that assignment's explicit retry
budget and create a new attempt identity. An uncertain command, changed host
identity, or unconfirmed cancellation enters reconciliation and is not
automatically duplicated. Reconciliation is a runtime outcome; the task
coordinator decides whether a later task phase needs a return.

When a live Teamwork wait returns a host continuation, resume only that
continuation until it resolves, times out, or errors. Do not run another
host action meanwhile, including another wait, shell command, or status/message
query. An empty transport slice does not mean the wait has completed. Run
diagnostics only after the continuation returns and diagnosis is needed.

Use the ordinary Teamwork Session commands for a deliberate one-shot or
interactive discussion:

```bash
trellis teamwork run [name]
trellis teamwork spawn <name> --agent teammate --provider <provider> \
  --as reviewer --file .trellis/tasks/<task-dir>/prd.md \
  --jsonl .trellis/tasks/<task-dir>/research.jsonl
trellis teamwork send <name> --as <agent> --stdin
trellis teamwork wait <name> --as <agent> --kind done,turn_finished
trellis teamwork interrupt <name> --as <agent> --to <teammate> --stdin
trellis teamwork kill <name> --as <teammate>
```

These commands operate a Teamwork Session and do not replace a frozen plan or
create a second scheduler. Do not use them to bypass a rejected batch or to
steer an active managed assignment manually.

`spawn` registers an idle teammate; the first targeted `send` starts its turn.
The agent card can set provider defaults, while `--provider`, `--model`,
`--cwd`, `--resume`, `--sandbox`, `--timeout`, and `--warn-before` refine one
launch. `--file` accepts repeatable paths or globs. `--jsonl` accepts a
repeatable Trellis JSONL manifest whose entries have `{ "file", "reason" }`.
Both forms are resolved relative to the spawn cwd, reject paths outside the
cwd or configured trusted roots, skip missing entries with a warning, and
enforce per-file and total-context limits before building the system prompt.

Use `--inbox-policy explicitOnly|broadcastAndExplicit` to control which
messages are delivered to a teammate. `send --to` selects recipients and
`--delivery-mode appendOnly|requireKnownWorker|requireRunningWorker` controls
target validation. The runtime records the injected files, manifest paths,
provider identity, and terminal event in the session log.

The guard resolves CLI flags, then environment variables, then
`teamwork.teammate_guard` in `.trellis/config.yaml`, then built-in defaults.
`--idle-timeout` cleans a continuously idle teammate; `--max-live-teammates`
limits live processes. A value of `0` disables the corresponding guard. An
idle teammate is not cleaned while it is in a turn. `interrupt` requests a
replacement instruction, `kill` attempts graceful shutdown, and `kill --force`
uses the hard termination path. `--resume` supplies the provider session or
thread identifier for a later attempt.

For short independent work, `teamwork run` creates an ephemeral session,
injects the selected context, sends one prompt, waits for `done`, prints the
answer, and removes the session. For a managed plan, the coordinator owns
claim, dispatch, retry budget, terminal receipt, and reconciliation. An
uncertain provider action is reconciled instead of being duplicated. Settled
attempt artifacts may be cleaned according to the plan retention rule; the
Teamwork Session event log follows its own lifecycle.

For a stalled process, inspect `teamwork list`,
`teamwork messages <session> --raw --no-progress`, the provider log, and the
host process state in that order. Use `messages --follow` for live output and
the `--since`, `--kind`, `--from`, `--to`, `--thread`, and `--action` filters
to isolate a turn. Use `kill` only when the process owner and current state
are known. The runtime event log is the source of truth for coordination
state; sidecar process files are diagnostic evidence. The hidden
`teamwork __supervisor` and `__parse-trace` commands are runtime internals,
not user-facing dispatch entry points.
