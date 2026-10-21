# Trellis rollout owner design

The root rollout revision 3 is the approved cross-repository plan. This task owns its Trellis steps only: fix the preview write, restore the nested Marketplace checkout, publish the beta and materialize this project's assets.

`pruneOrphanManifestKeys` already accepts `persist: false`. Pass `persist: !options.dryRun` at the update call site, so planning still receives the pruned in-memory map. Exercise a real initialized temporary project with an orphan hash in the existing integration test and compare manifest bytes. Other callers and the default persistence contract stay unchanged.

Marketplace remains an independent repository on `main`. Publish its approved source before adding `marketplace` to this repository with Git's native submodule commands. Keep `docs-site`, the existing npm files whitelist and release checkout settings. Root removes its direct checkout only after this nested checkout is verified.

All changes target `pennix/v0.7-beta`. Run owner quality gates and native release preflight before `pnpm release:beta`; resolve the actual next beta from current tags/registry. Lifecycle installs that released candidate before any project update. Preview first, review conflicts, then use native update without force/skip-all. Native workflow verification and custom-content checks precede owner finish/archive.

Risks are preview writes, publishing an incorrect candidate, duplicate Marketplace sources and overwriting project customizations. The regression, exact published SHAs, package boundaries, reviewed dry-runs and workflow provenance checks guard these risks. On failure retain evidence and stop the dependent operation; use native rollback/restore contracts, never rewrite published tags or generated state. The root owns cross-layer Lifecycle and final host acceptance.

Stop when this owner has passed its checks, the release and project assets are verified, native archive is committed and pushed, and root has its final SHA. The unrelated subnode task is not part of completion.
