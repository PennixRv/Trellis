# Implementation Plan

1. [x] Re-establish Trellis context, inspect the applicable release, migration,
   platform, workflow, package-boundary, and test conventions.
2. [x] Fetch and compare upstream beta, Pennix stable `main`, the current beta
   branch, Marketplace refs, tags, and npm metadata without changing stable
   refs.
3. [x] Build the reconciliation matrix and inspect source/template/dogfood parity,
   bundled skills, migration continuity, release scripts, and packed artifacts.
4. [x] Record each discrepancy in the matrix; fix only confirmed omissions and add
   focused regression checks where behavior could regress.
5. [x] Run GitNexus change detection and targeted impact checks, then run lint,
   typecheck, build, tests, package preflight, and tarball inspection.
6. [x] Push required Marketplace changes first, then the Trellis beta branch and
   next continuous annotated beta tag through the existing CI workflow.
7. [x] Wait for the publish workflow to finish, verify both npm packages and
   dist-tags, and run the isolated npm install/init/update/task-state smoke
   test.
8. [x] Update this task with exact evidence, archive it, commit the archive record,
   push the beta branch, and leave stable `main`/`latest` unchanged.

## Required checks

```text
python3 ./.trellis/scripts/get_context.py --mode phase --step 2.1
pnpm lint
pnpm typecheck
pnpm build
pnpm test
node .gitnexus/run.cjs detect-changes --scope all --repo .
```
