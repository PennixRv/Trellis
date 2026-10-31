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

Use the ordinary Teamwork Session commands for a deliberate one-shot or
interactive discussion:

```bash
trellis teamwork run [name]
trellis teamwork spawn <name> --agent <agent> --provider <provider>
trellis teamwork send <name> --as <agent> --stdin
trellis teamwork wait <name> --as <agent> --kind done,turn_finished
trellis teamwork interrupt <name> --as <agent> --to <teammate> --stdin
trellis teamwork kill <name> --as <teammate>
```

These commands operate a Teamwork Session and do not replace a frozen plan or
create a second scheduler. Do not use them to bypass a rejected batch or to
steer an active managed assignment manually.

For a stalled process, inspect `teamwork list`, `teamwork messages --raw`, the
provider log, and the host process state in that order. Use `kill` only when
the process owner and current state are known. The runtime event log is the
source of truth for coordination state; sidecar process files are diagnostic
evidence.
