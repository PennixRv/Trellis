# Teammate processes

The coordinator creates a queue fact and an immutable claim for each
assignment, dispatches the selected provider, waits for a terminal host fact,
and validates the report against the assignment identity, source digest,
evidence, path, secret, and symlink rules. The teammate writes only its
current attempt artifacts. It does not modify product source, Git state, task
status, or another teammate's artifacts.

When a managed batch runtime wait yields before the frozen deadline, the CLI
may continue waiting on the same provider process and attempt identity. This
continuation does not send another provider prompt, extend the deadline, or
consume the full-attempt retry budget. The CLI keeps other active slots moving
while that wait is pending. At the deadline it closes FIFO admission and
cancels active attempts. A confirmed execution or acceptance failure may
consume the assignment's explicit retry budget and create a new attempt
identity. A `blocked` report with evidence ends only that assignment and does
not stop later FIFO work. An uncertain command, changed host identity,
incomplete report write, or unconfirmed cancellation enters reconciliation and
is not automatically duplicated. Reconciliation is a runtime outcome; the
task coordinator decides whether a later task phase needs a return.

For an interactive Teamwork Session `wait` invoked as a host tool, resume only
that host continuation until it resolves, times out, or errors. Do not run
another host action meanwhile, including another wait, shell command, or
status/message query. An empty transport slice does not mean the wait has
completed. Run diagnostics only after the continuation returns and diagnosis
is needed. This host-tool rule does not control a managed `teamwork batch`:
that foreground CLI call owns the batch lifecycle and returns one receipt.

Use the ordinary Teamwork Session commands for a deliberate one-shot or
interactive discussion:

```bash
trellis teamwork run [name] --profile exploration --configuration codex-sol
trellis teamwork spawn <name> --profile review --configuration copilot-opus \
  --as reviewer --file .trellis/tasks/in_progress/<task-dir>/prd.md \
  --jsonl .trellis/tasks/in_progress/<task-dir>/research.jsonl
trellis teamwork send <name> --as <agent> --stdin
trellis teamwork wait <name> --as <agent> --kind done,turn_finished
trellis teamwork interrupt <name> --as <agent> --to <teammate> --stdin
trellis teamwork kill <name> --as <teammate>
```

These commands operate a Teamwork Session and do not replace a frozen plan or
create a second scheduler. Do not use them to bypass a rejected batch or to
steer an active managed assignment manually.

`spawn` registers an idle teammate; the first targeted `send` starts its turn.
The project profile supplies the common and professional role cards plus
execution defaults. `--profile` and `--configuration` select them;
`--reasoning-effort`, `--provider`, `--model`,
`--cwd`, `--resume`, `--sandbox`, `--timeout`, and `--warn-before` refine one
launch. `--file` accepts repeatable paths or globs. `--jsonl` accepts a
repeatable Trellis JSONL manifest whose entries have `{ "file", "reason" }`.
Both forms are resolved relative to the spawn cwd, reject paths outside the
cwd or configured trusted roots, skip missing entries with a warning, and
enforce per-file and total-context limits before building the system prompt.
Legacy generic `--agent <card>` remains available for deliberately custom
agent cards, but it cannot be combined with professional profile selection.
Interactive roles return the requested answer; they do not invent batch
claims, report paths or attempt identities.

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

Codex interrupts use `turn/interrupt` and await the old terminal turn before
submitting the replacement. ACP sends `session/cancel` and awaits the terminal
prompt response; sending a notification alone is not cancellation proof.
Batch cancellation additionally confirms provider process exit. Unconfirmed
termination preserves reconciliation and its capacity reservation. Session
removal and prune preserve sessions with unresolved batch reservations.

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
