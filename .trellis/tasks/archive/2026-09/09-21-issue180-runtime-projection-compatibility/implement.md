# Implementation plan

1. Add a narrow content migration helper to `update.ts` and route a recognized legacy Hook through `autoUpdateFiles`.
2. Update the Trellis dogfood Pennix Hook to the current ambiguity projection.
3. Add integration coverage for recognized and unrecognized Hook variants.
4. Run focused tests, full CLI quality gates, release preflight, build and publish the synchronized CLI/core patch release from `main`.
5. Reinstall the released CLI, run `trellis update` in the root workflow, and verify the live Hook renders ambiguity without changing task state.
