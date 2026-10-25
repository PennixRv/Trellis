<!-- trellis-implementation-plan:v1 -->

```json
{
  "schema_version": 1,
  "steps": [
    {
      "id": "complete-native-quality-contract",
      "depends_on": [],
      "target": "packages/cli/src/templates/trellis/workflow.md and packages/cli/test/templates/trellis.test.ts",
      "action": "Retain the existing Phase 2.2 and in_progress dispatch rules. Make the risk-based comparison, uncovered-case additions, conditional independent review, in-scope fix/retest, and full execution checkpoint fields explicit. Mirror the guidance in in_progress-inline. Add focused assertions for 2.2 and both active breadcrumbs.",
      "deliverables": "Canonical workflow wording and a regression test that fails if either execution breadcrumb loses the approved completion contract.",
      "verification": "Run the focused trellis template test and formatting/lint checks on the changed source and test.",
      "risks": "The inline path can silently omit main-session execution guidance if only the generic 2.2 walkthrough or dispatch breadcrumb is updated.",
      "rollback": "Revert only the workflow wording and corresponding assertions; retain the already existing Teamwork skill contract."
    },
    {
      "id": "sync-marketplace-owner",
      "depends_on": ["complete-native-quality-contract"],
      "target": "Marketplace main: workflows/native/workflow.md, index.json, and its task record",
      "action": "Update the Marketplace owner task, mirror the canonical workflow byte-for-byte, and refresh the native entry SHA-256. Do not modify the TDD workflow or any other catalog entry.",
      "deliverables": "Marketplace native mirror, correct digest, owner execution receipt, and local Marketplace commit.",
      "verification": "Run Marketplace unittests, compare mirror bytes, independently calculate the indexed digest, and inspect the staged diff.",
      "risks": "A stale mirror or digest makes the downloadable template differ from the candidate Trellis source.",
      "rollback": "Revert only the Marketplace mirror, digest, and this owner record if checks disagree; do not push."
    },
    {
      "id": "validate-and-commit-candidate",
      "depends_on": ["sync-marketplace-owner"],
      "target": "Trellis v0.7.1 source, tests, owner task, and nested Marketplace gitlink",
      "action": "Run focused and full component gates, review the complete source-to-acceptance diff, fix any in-scope findings and repeat affected checks. Update the candidate Marketplace gitlink to the Marketplace commit and commit the Trellis owner task. Preserve docs-site and root workflow/production pin boundaries.",
      "deliverables": "Passing verification receipts, completed owner task, Marketplace and Trellis commits, and exact final revisions recorded in the root audit.",
      "verification": "Trellis CLI template tests, full tests, lint, typecheck, Python checks, build, Marketplace integration tests, mirror/digest checks, clean staged-diff review, and candidate/root/docs-site status review.",
      "risks": "The candidate task may pass static checks while real host execution and the eventual root integration remain untested.",
      "rollback": "Keep the candidate work on the existing v0.7.1 and Marketplace main refs; if a gate fails, leave the affected task open and do not change root pins or publish."
    }
  ],
  "stop_point": {
    "condition": "The workflow contract is present in 2.2 and both active breadcrumbs, regression assertions pass, Marketplace mirror and digest are exact, all required candidate checks pass, and each owner commit is recorded.",
    "observable_evidence": "Source/test diff, test and quality receipts, byte/hash comparison, Marketplace/Trellis commit SHAs, candidate Marketplace gitlink, and root review disposition.",
    "remaining_work": "Root integration, production pin, docs-site commit/pin, host execution, tag, release, push, and switch-over belong to later explicit tasks.",
    "failure_exit": "Record failed or unrun checks and next action in execution.md; do not mark task acceptance, alter root state, push, or release."
  }
}
```

<!-- /trellis-implementation-plan:v1 -->
