# Design

## Boundary

Trellis owns Channel worker identity, supervision, event ordering, worker
budgeting, and the bundled subnode procedure. OpenViking owns memory recall and
capture for the main session; a subnode is an independent evidence worker and
must not participate in that memory flow.

## Runtime shape

Reuse the current per-project live-worker guard as the resource gate and the
existing `brief.json`/`worklog.md`/`report.json` paths as the assignment
boundary. The `subnode` agent card declares a sibling `subnode.env` role file;
the channel runtime parses its plain `KEY=VALUE` entries and persists the
result in the existing supervisor config, whose generic environment merge
passes them to the provider child. This removes repeated caller flags and
keeps OpenViking role policy in the bundled role asset rather than the core
supervisor. The role file passes `OPENVIKING_AUTO_RECALL=0`,
`OPENVIKING_AUTO_CAPTURE=0`, and `OPENVIKING_NO_AUTO_INJECT=1` to subnodes.

The lifecycle remains event-driven: prepared brief -> spawned/running ->
terminal -> report pending -> coordinator disposition. `channel wait` remains
the event notification path. `channel workers --include-terminal --json` is a
read-only query of the existing durable worker projection for terminal
confirmation and recovery; it does not poll or create a second ledger. A
terminal event without a valid report is a recovery condition, not completion.
The helper binds `channel_ref.worker_handle` to `subnode_id`, and its
`disposition` command validates the report then creates one immutable
`disposition.json`. The coordinator supplies the terminal observation and
records the independent report, source, and protected-target checks. No global
claim registry, scheduler, worker-owned lifecycle writes, model-confidence
rule, automatic retry, heartbeat, or new permission model is added.

The eight-slot rule is a configurable procedure default, not a flag hardcoded
in the procedure text. `.trellis/config.yaml#channel.subnode` supplies
`max_live_workers` (generated default `8`), `idle_timeout`, `timeout`, and
`warn_before` for `spawn --agent subnode`; explicit CLI flags remain one
dispatch overrides. Guard environment variables retain their existing
precedence, followed by the role section, generic `channel.worker_guard`, and
the built-in defaults. If the role section is absent, code defaults preserve
the subnode budget (`8`), timeout (`30m`), and warning lead (`5m`); an omitted
role idle value falls through to the existing generic worker guard so older
project tuning remains effective. Ordinary workers retain `6`.
Assignment identity, task paths, context files, and report paths remain
per-brief values and are deliberately not globalized.

## Compatibility and rollout

The new flag is optional and absent from existing callers. Existing supervisor
configs without `env` remain valid. The bundled template is updated through the
normal template source and project update path. Release CLI/core together only
after targeted and full checks pass.
