# Implementation plan

1. Start the owner task after the CLI snapshot is recorded; inspect current
   branch/diff and run the GitNexus impact query for the event type.
2. Add optional F11 receipt fields to the Core event type and focused tests if
   the existing type contract does not already cover them.
3. Run only the authorized I05/I06 focused checks now; defer all other tests,
   lint, typecheck, build, and release checks until every owner finishes.
4. Record the Core handoff and return the shared checkout to the CLI/Marketplace
   sequence.
