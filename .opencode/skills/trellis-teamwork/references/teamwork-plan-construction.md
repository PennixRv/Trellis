# Teamwork plan construction

The current phase coordinator constructs one Teamwork plan when a bounded
teammate call is useful. The plan is a runtime input, not a second task plan.
It records the task and phase context that produced it:

```text
task_id
phase_id
task_route_revision
input_revision
plan_summary
coordination_mode
```

The plan also freezes the Teamwork Session, batch, deadline, protected targets,
and ordered `assignments`. Each assignment has an `assignment_id`, selected
profile/configuration, selection reason, task input, scope, optional lens,
source digest, acceptance criteria, and an explicit retry budget. The native
constructor resolves the effective provider/model/effort/options and common
plus professional instructions, then publishes schema-2 plan and briefs.
Claims also use schema 2; reports remain schema 1. Do not hand-author frozen
execution objects, role or capability digests, claims, or plan hashes.

Use the native task lifecycle for task status and acceptance. Teamwork records
coordination facts and teammate reports; it does not write `current_phase_id`,
task status, phase acceptance, or delivery readiness. Accepted reports and
their evidence become task-owned acceptance inputs. Temporary plan, queue,
attempt, and verification data may be removed when the batch ends according to
the task's retention rule. The Teamwork Session itself has its own lifecycle.

## When to construct a plan

Use a plan for independent evidence, review, research, or verification with a
clear report destination. Keep dependent steps, shared source edits, and work
that requires peer conversation in the main task flow or a Teamwork Session.
Use a single bounded teammate call for one self-contained question. Use a
forum Teamwork Session when a topic needs durable threads and status history.

Before dispatch, read the active task plan, current phase checkpoint, relevant
specs, and the generic teammate role card. Freeze the input revision and route
revision after the coordinator has selected the scope. If those values change,
construct a new plan rather than mixing results from different task inputs.

Construct and run through the native entry points:

```bash
trellis teamwork config --profile review --mode advisor
trellis teamwork plan <draft.json> --task <task-dir> --output <task-dir>/plan.json --dry-run
trellis teamwork plan <draft.json> --task <task-dir> --output <task-dir>/plan.json
trellis teamwork batch <task-dir>/plan.json --task <task-dir> --preflight
trellis teamwork batch <task-dir>/plan.json --task <task-dir>
```

The draft is a JSON object with `schema_version: 2`, the binding fields above,
safe `batch_id` and `session_id`, `deadline`, optional `requested_capacity`
and `protected_targets`, and explicit `assignments`. A minimal member is:

```json
{
  "assignment_id": "review-a",
  "profile": "review",
  "configuration": "codex-sol",
  "selection_reason": "Use the configured source reviewer",
  "summary": "Review the selected change",
  "scope": "src/example.ts",
  "input": "Inspect the assigned source and return evidence in the requested report.",
  "source_digest": "<SHA-256 of the selected source evidence>",
  "acceptance": ["Cite precise source locations and explain observable impact"],
  "max_retries": 0
}
```

Optional member overrides are `provider`, `model`, `reasoning_effort`, and
adapter-supported `options`; context comes from `context_files` and
`context_manifests`. Committee members additionally need distinct `lens`
values and otherwise share the same task/evidence/acceptance contract. The
constructor creates their evaluation group. Read the configuration matrix
before choosing candidates. Output must be inside the selected task under
this project's `.trellis/tasks/`; existing immutable artifacts are preserved.

`--dry-run` validates all prepared briefs and paths without writing artifacts.
`--preflight` validates frozen inputs, current native task revisions and
capacity without launching a provider; `processProbe: not_run` means accounts,
models and transport have not been tested by that command. Actual dispatch
negotiates provider model and effort and fails explicitly if unsupported.

The foreground CLI owns dispatch, waiting, report acceptance, retries, process
shutdown and the terminal receipt. Do not add a second scheduler or retry
loop. `run` and `spawn` operate interactive sessions and do not bypass batch
reconciliation. A restart returns a durable terminal receipt or
`RECONCILIATION_REQUIRED`; it never silently replays an uncertain attempt.
Capacity reservations survive a coordinator crash because a dead coordinator
does not prove its provider processes exited. Do not delete an unresolved
reservation to make another batch fit; inspect ownership and terminal evidence.

## Teamwork Session and forum commands

Create and inspect the durable runtime object with the native CLI:

```bash
trellis teamwork create <name> --type chat|forum \
  --task .trellis/tasks/in_progress/<task-dir> --description "bounded discussion"
trellis teamwork list [--scope project|global] [--all]
trellis teamwork messages <name> [--raw]
trellis teamwork wait <name> --as <agent> --kind done,turn_finished
trellis teamwork forum <name>
trellis teamwork thread <name> <thread-key>
trellis teamwork context list <name> [--thread <thread-key>]
```

Use `--scope global` only for a deliberately shared board; the default project
scope is isolated by the current project bucket. `create` also accepts
`--labels`, `--cwd`, `--by`, `--force`, `--context-file`, `--context-raw`, and
`--ephemeral`. Ephemeral sessions are hidden from `list` unless `--all` is
passed and are intended for short-lived coordination.

For a forum, append structured thread events with `opened`, `comment`,
`status`, or `summary` and inspect the reduced board or event timeline:

```bash
trellis teamwork post <session> opened --as main --thread design \
  --title "Design question" --description "What needs evidence?"
trellis teamwork post <session> comment --as reviewer --thread design \
  --stdin
trellis teamwork post <session> status --as main --thread design --status open
trellis teamwork post <session> summary --as main --thread design \
  --summary "Evidence collected"
trellis teamwork forum <session> --status open
trellis teamwork thread <session> design
trellis teamwork thread rename <session> design architecture --as main
```

`post` can also replace labels or assignees and attach thread context with
`--context-file` / `--context-raw`. Session-level context uses
`teamwork context add|delete|list`; context deletion appends a durable
projection event rather than rewriting the event log. Use `title set` and
`title clear` for the display title.

Use `--stdin` or `--text-file` for long message and thread bodies. `messages`
supports `--raw`, `--follow`, `--last`, `--since`, `--kind`, `--from`, `--to`,
`--thread`, `--action`, and `--no-progress`. `--kind` selects runtime event
kinds; it is not a user-defined tag. Read forum summaries and thread
projections through the CLI before inspecting raw event storage.

Remove settled runtime state deliberately. `rm <name>` stops live teammates
before deleting one session. `prune` is a dry-run by default and supports one
of `--ephemeral`, `--empty`, `--idle <duration>`, or `--all`, plus `--keep`;
pass `--yes` to perform the deletion. Never use session cleanup as a task
archive operation.

## Result handling

The coordinator returns `ALL_ACCEPTED`, `SETTLED_WITH_FAILURE`, or
`RECONCILIATION_REQUIRED`. A terminal receipt is a runtime fact. The main task
then reviews reports against the phase contract, records durable evidence in
the task-owned artifact, and uses the task's native acceptance gate before
advancing. A formal session handoff is an independent, lower-priority
continuity artifact and does not represent a phase transition.
