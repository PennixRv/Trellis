# Implementation Plan

1. Add the analysis-only classification and direct completion route to the
   native workflow template, including both planning breadcrumb variants.
2. Synchronize the common start, brainstorm, continue, and finish-work entry
   templates with the exact metadata condition and the ordinary-task exclusion.
3. Add template-level assertions for all required route statements and verify
   that the existing planning/start gate remains present for change-bearing
   tasks.
4. Run focused CLI template tests, then the package lint, typecheck, format
   check, and affected integration tests.

## Rollback

Revert only the template and test commit. No task status, runtime pointer, or
user-project data migration is involved.
