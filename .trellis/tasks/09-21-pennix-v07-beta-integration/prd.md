# Integrate Pennix v0.7 Beta Workflow Release

## Goal

Deliver a usable Pennix Trellis beta based on upstream `v0.7.0-beta.4`. It
must retain all applicable Pennix workflow semantics, permit clearly bounded
direct small work without a task, and be published and reinstalled as a
verified Pennix package release.

This is a semantic integration, not a merge of historical branches. Every
Pennix behavior must be placed at the ownership surface used by upstream beta,
even if beta moved its runtime, template, workflow, or spec location.

## Modification Target And Scope

- Primary source: `/home/penn/devel/Trellis`, branch `pennix/v0.7-beta`, based
  on `mindfold-ai/Trellis@be9e19b269c25cb2787489eb81062bf96619442c`.
- Companion source: the `marketplace` submodule, using a Pennix beta branch
  rooted at the upstream beta Marketplace commit.
- External delivery: `PennixRv/Trellis`, `PennixRv/marketplace`, npm packages
  `@pennixrv/trellis` and `@pennixrv/trellis-core`, both under npm's `beta` tag.
- Local delivery: reinstall the published Pennix beta and verify it from the
  registry in an isolated temporary project.

The root coordination repository is evidence-only. Its dirty working tree is
outside this task and must remain untouched.

## Requirements

1. Preserve the complete upstream beta capability set, including lifecycle
   safety, Channel correctness, context injection, memory/platform additions,
   and guarded `trellis ablate`; do not weaken beta safeguards.
2. Account for every functional Pennix delta from `origin/main@962d8dbd` in a
   reconciliation matrix. Every row must say whether it is retained,
   beta-superseded, intentionally excluded, or relocated to another beta owner.
3. Keep `@pennixrv/trellis` and `@pennixrv/trellis-core` as one lockstep Pennix
   release identity. Do not publish upstream scopes or change npm `latest`.
4. Retain Pennix active-task resilience without undoing upstream #608: direct
   session ownership remains authoritative, its single-session fallback remains
   opt-in, and Pennix `unbound` / `unbound_ambiguous` remain non-binding,
   developer-owned projections with correct Hook rendering.
5. Retain applicable Pennix continuation/ownership, sealed handoff,
   analysis-only, managed Codex subnode, Channel lifecycle, telemetry,
   recovery, and release/template continuity behavior at beta's actual owners.
6. Build and validate a Pennix Marketplace beta companion, preserving the
   `PennixRv/marketplace` URL before updating the Trellis Gitlink.
7. Add one shared direct-small-work policy to the core generated workflow and
   all Pennix Marketplace workflows. Explicit, bounded, single-surface work
   with an immediate check may proceed directly; it must still escalate before
   broad, multi-owner, architectural, release, credential, or durable-record
   work and retain ordinary safety confirmations.
8. Keep generated templates, workflow-state breadcrumb text, Hooks, runtime
   state, specs, and tests consistent. Do not add a direct task status, Hook
   flag, CLI command, or Skill.
9. Preserve managed-file update/conflict handling; beta updates must not force
   overwrite user-modified workflow files.
10. Publish an immutable prerelease, initially `0.7.0-beta.4.pennix.1` if it is
    free, under npm `beta`; push the Trellis and Marketplace beta branches, tag
    and release metadata, then reinstall locally.

## Non-Goals

- Do not merge or replay the 113 mixed Pennix `0.6.x` commits blindly.
- Do not import old release manifests, task archives, journals, or incidental
  documents merely because they are present on the old branch.
- Do not alter stable `0.6.45`, npm `latest`, user workflows, credentials, or
  root-repository source.
- Do not create a second direct-work lifecycle, ledger, automatic task rule, or
  model-only size threshold.

## Acceptance Criteria

- [ ] The integration branch remains rooted at upstream `v0.7.0-beta.4`, and
      all beta capabilities remain covered by upstream tests.
- [ ] A checked-in reconciliation matrix accounts for each functional Pennix
      capability group, beta owner/final landing, disposition, and proof.
- [ ] Package identity, version, contents, release metadata and Marketplace
      Gitlink consistently identify one Pennix beta release.
- [ ] Resolver coverage proves direct binding, opt-in fallback, one unbound
      candidate, multiple candidates, ambiguous rendering, and no session write.
- [ ] Pennix lifecycle, ownership, handoff, analysis-only, managed subnode and
      status/telemetry contracts pass focused beta-era regression coverage.
- [ ] Core and every Pennix Marketplace workflow share the direct-small-work
      policy, allowing bounded progress but requiring escalation where needed.
- [ ] A modified-workflow fixture proves `trellis update --dry-run` preserves
      managed conflict behavior.
- [ ] Formatter, typecheck, lint, focused tests, full tests, pack/preflight and
      GitNexus change analysis pass.
- [ ] The Marketplace beta branch and tested Gitlink are pushed; `.gitmodules`
      still names Pennix.
- [ ] Both `@pennixrv` packages are published only with npm `beta`, reinstalled,
      and verified through `init`, `update --dry-run`, state rendering and
      workflow-generation smoke checks in an isolated project.

## Authority

The user explicitly authorized task creation, implementation, commits, remote
pushes, beta publication, and local reinstallation. Normal registry, Git,
credential, and destructive-operation safeguards remain in force.
