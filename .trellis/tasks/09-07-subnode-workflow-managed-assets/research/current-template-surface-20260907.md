# Current Template Surface (2026-09-07)

## Verified Facts

- `packages/cli/src/templates/trellis/index.ts` is the single registry for
  managed Python scripts and Channel agent cards. `trellis init` consumes its
  agent map in `configurators/workflow.ts`; `trellis update` consumes it through
  `collectTemplateFiles`.
- The repository regression suite requires every Python file under
  `packages/cli/src/templates/trellis/scripts/` to be registered, and requires
  that tree to be byte-identical to the dogfood `.trellis/scripts/` tree.
- The existing bundled `trellis-channel` documentation already describes
  create/spawn/send/wait semantics and explicitly distinguishes event `kind`
  from opaque tags. It contains no project-specific `parallel-work` protocol,
  `CANDIDATE_REPORT` payload contract, or sandbox requirement to remove.
- `workspace_note.py` intentionally creates a durable workspace file. Its
  verification must prove that it does not invoke Git or mutate task, journal,
  or workspace-index state; requiring an unchanged working-tree status would
  contradict the expected creation or modification of `working-notes.md`.

## Impact Boundary

GitNexus analysis before implementation found the following existing callers:

- `getAllScripts` has one direct caller, update template collection.
- `getAllAgents` has direct callers in update collection and workflow
  initialization.
- The bundled-skill enumerator has a broad fan-out. This task only adds a file
  inside the existing `trellis-channel` bundle and does not alter the enumerator.

The implementation therefore adds registered managed assets and tests their
public behavior without changing Channel runtime lifecycle, event schemas,
worker guards, or marketplace-native defaults.
