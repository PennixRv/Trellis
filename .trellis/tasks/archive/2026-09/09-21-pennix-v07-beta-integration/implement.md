# Implementation And Delivery Plan

## 1. Establish the Reconciliation Baseline

1. Verify beta, Pennix-main and Marketplace ref identities; record them in
   `research/reconciliation-matrix.md`.
2. Read beta package/release scripts, template registry, active-task resolver,
   workflow-state contract, Channel code, managed assets, specs and tests.
3. Classify every functional Pennix capability by beta owner, disposition,
   landing and proof. Explicitly exclude historical/release-only artifacts.

## 2. Reconcile Runtime And Assets

1. Restore Pennix package scope/release ownership with beta-compatible manifests.
2. Adapt `unbound` / `unbound_ambiguous` atop beta #608; update resolver, Hook
   rendering and tests together, proving no binding write.
3. Reconcile continuation, ownership/recovery, analysis-only, managed-project,
   Channel/subnode and telemetry behavior at their beta owning layers.
4. Run GitNexus impact before every affected symbol and add focused regression
   proof in the owning package.

## 3. Reconcile Marketplace And Direct Small Work

1. Create Marketplace `pennix/v0.7-beta` from `62a77c9b`, port applicable
   Pennix workflow contracts in beta's layout and verify them.
2. Preserve `PennixRv/marketplace` in `.gitmodules`, push the companion branch,
   and only then advance the Trellis Gitlink.
3. Add the same direct-small-work policy to core and all four Marketplace
   workflow families; replace Codex subnode's absolute `Do not implement` text.
4. Add template tests for bounded direct progress, required escalation and
   unchanged destructive/credential safeguards. Add no status, CLI, Hook or
   Skill.

## 4. Verify Source And Managed Updates

1. Run exact beta formatter, typecheck, lint, focused resolver/channel/template
   tests and the complete suite.
2. Run GitNexus `detect-changes` against the integration base and resolve every
   HIGH, CRITICAL, UNKNOWN, partial or truncated finding.
3. Pack both packages and inspect names, versions and contents.
4. In an isolated project, initialize Trellis, modify a managed workflow, run
   `trellis update --dry-run`, verify conflict sidecar behavior, state rendering
   and direct-small-work policy output.

## 5. Commit, Publish And Reinstall

1. Commit coherent source/template/Gitlink/task changes on the beta branch.
2. Run the current release preflight; push Trellis and Marketplace beta branches,
   create lockstep version/tag/release metadata, then publish both packages only
   with npm `beta`.
3. Verify registry version, tag, ownership and archive integrity. A publish
   failure is diagnosed completely before one focused correction; corrections
   use a new prerelease, never retagging an existing one.
4. Reinstall from npm, confirm version and package identity, then run isolated
   `init`, `update --dry-run`, state and workflow-generation smoke tests.
5. Record release version, commit IDs, Marketplace pin and installation proof;
   perform final change analysis, archive the task and journal the result.

## Failure Boundaries

- Before publication, only change the new beta branches; never rewrite `main`.
- After publication, issue a later prerelease for a correction; do not move
  `latest` or recover by retagging/unpublishing.
- If beta relocates or invalidates a Pennix contract, return to the matrix and
  redesign that row before implementation continues.
