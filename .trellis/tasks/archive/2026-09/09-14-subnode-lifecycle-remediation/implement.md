# Implementation Plan

1. Read the external lifecycle comparison in `research/external-lifecycle.md`
   and rerun GitNexus impact for the worker query, artifact helper, spawn
   option, and bundled procedure.
2. Keep the role-bound `env_file` loading in the existing supervisor config
   path. Parse the sibling file as plain `KEY=VALUE` entries; do not add a
   repeated `--env` caller flag.
3. Bind `channel_ref.worker_handle` to the immutable `subnode_id` in the
   artifact helper.
4. Expose a small `channel workers` CLI command backed directly by core's
   `listWorkers`, with `--include-terminal` and `--json`; do not reparse event
   logs or PID files in the new command.
5. Add `subnode_artifact.py disposition`: validate the report, require the
   coordinator's three independent checks and a terminal observation, and
   create `disposition.json` exactly once. Keep the artifact helper out of
   Channel runtime ownership.
6. Update both shipped and dogfood subnode procedures with the wait/query,
   recovery, disposition, and configurable eight-slot operating sequence.
   Use `channel.subnode` for resource/lifetime defaults; do not hardcode the
   budget in the procedure or alter ordinary worker defaults.
7. Add regression coverage for worker-handle binding, CLI projection output,
   disposition validation/create-once behavior, environment propagation, and
   template/config synchronization; run targeted and full checks.
8. Run GitNexus detect-changes, inspect the final diff, commit, publish, and
   reinstall only after acceptance.

Rollback: revert the component commit; the role `env_file` is optional and old
agent cards and supervisor configs continue to run without it.

## Verification Record

- Targeted tests: `151 passed` across channel guard/context/run/workers,
  artifact, template, and update suites.
- Full project tests: core `377 passed | 1 skipped`; CLI `1960 passed` across
  `89` files.
- Static checks: `pnpm lint`, `pnpm lint:all`, `pnpm typecheck`, and
  `pnpm build` passed. Python lint reports `0 errors` and `68` existing
  unused-re-export warnings.
- Manifest gate: published-version continuity passed after restoring the
  missing no-migration `0.6.28` entry and adding the `0.6.29` release entry.
- GitNexus: `detect-changes` resolved `22` affected execution flows, including
  channel spawn/run and template update consumers; this high-risk result was
  reviewed before release.
- Asset parity: project and shipped `subnode.md`, `subnode.env`,
  `subnode_artifact.py`, and the bundled `subnode-work.md` are byte-identical
  where each project/shipped pair exists.
- External comparison: LangGraph, Temporal, AutoGen, CrewAI, and OpenHands
  references are recorded in `research/external-lifecycle.md`; only explicit
  terminal observation, durable projection, and coordinator disposition were
  adopted.
