# Implementation plan

1. Start this owner task with the current session identity and recheck branch,
   dirty paths, active task overlap, and GitNexus impact before source writes.
2. Implement and locally inspect F11 template, resolver, CLI options, spawn /
   supervisor / adapter propagation, event metadata, and focused tests.
3. Record a reconstructable CLI baseline snapshot. Do not run the full suite,
   lint, typecheck, build, or release checks before all owners finish.
4. Hand off the shared checkout to Core and wait for root G1 acceptance.
5. Only after G1, implement the minimal F12 queue helper and focused tests,
   record G2 evidence, and hand off for final Marketplace/docs integration.
