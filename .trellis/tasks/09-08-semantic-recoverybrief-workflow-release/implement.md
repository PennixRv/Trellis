# Implementation Plan

1. Inspect Marketplace workflow, resolver smoke-test support, parent version
   metadata, release scripts, and the unrelated dirty paths.
2. Add the bounded contract and one research-record routing line to the
   existing Marketplace workflow. Improve the bundled Skill's discriminating
   trigger description, then test native temporary-project initialization and
   project update distribution from the candidate ref.
3. Commit, push, and tag the Marketplace release.
4. Advance the parent Gitlink, perform only required existing release metadata
   updates, run project release checks, then commit, tag, push, and verify.
5. If the existing release guard identifies a prior published manifest gap,
   backfill the verified non-migrating manifest before retrying the normal
   release flow; do not bypass the guard or extend its known-gap list.
