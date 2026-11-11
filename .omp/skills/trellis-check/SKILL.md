---
name: trellis-check
description: "Comprehensive quality verification: spec compliance, lint, type-check, tests, cross-layer data flow, code reuse, and consistency checks. Use when code is written and needs quality verification, before committing changes, or to catch context drift during long sessions."
---

# Code Quality Check

Comprehensive quality verification for recently written code. Combines spec compliance, cross-layer safety, and pre-commit checks.

---

## Step 1: Identify What Changed

```bash
git diff --name-only HEAD
git status
```

## Step 2: Read Task Artifacts and Applicable Specs

Read the current native phase, accepted contract and its actual artifact references for requirements, design, execution and validation. Common filenames such as `prd.md`, `design.md` and `implement.md` do not prove current acceptance or authorization. For taskless work, check the authorized bounded request.

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
```

Read the available `.trellis/spec/index.md`, affected configured package
indexes (`.trellis/spec/<package>/index.md`), and existing layer indexes.
Follow their **Quality Check** sections; older projects need no migration:

```bash
cat .trellis/spec/<package>/<layer>/index.md
```

Read the specific guideline files referenced — the index is a pointer, not the goal.

## Step 3: Run Project Checks

Run the applicable required project checks and verification appropriate to the changed behavior and risk. Investigate failures and fix those caused by the change within its authorization; record unrelated baseline failures and unavailable checks accurately. Do not silently expand the task to repair unrelated failures or claim checks passed when evidence is incomplete.

## Step 4: Review Against Checklist

### Code Quality

- [ ] Linter passes?
- [ ] Type checker passes (if applicable)?
- [ ] Tests pass?
- [ ] No debug logging left in?
- [ ] No suppressed warnings or type-safety bypasses?

### Test Coverage

- [ ] Non-trivial new behavior and risk covered by meaningful existing or new tests?
- [ ] Bug fix reproduced by a regression check at the actual entry path?
- [ ] Changed behavior reflected in tests without mirroring implementation details?

### Spec Sync

- [ ] Does `.trellis/spec/` need updates? (new patterns, conventions, lessons learned)

> "If I fixed a bug or discovered something non-obvious, should I document it so future me won't hit the same issue?" → If YES, update the relevant spec doc.

### Scope Discipline

- [ ] Any tidying of code the task did not require?
- [ ] Any abstraction, config or extension point added for a case that does not exist yet?
- [ ] Any speculative fallback for a state that cannot occur?
- [ ] Any file changed that the acceptance criteria do not mention?
- [ ] Any workaround added at the caller instead of a fix where the behavior actually lives?

## Step 5: Cross-Layer Dimensions (if applicable)

Skip this step if your change is confined to a single layer.

### A. Data Flow (changes touch 3+ layers)

- [ ] Read flow traces correctly: Storage → Service → API → UI
- [ ] Write flow traces correctly: UI → API → Service → Storage
- [ ] Types/schemas correctly passed between layers?
- [ ] Errors properly propagated to caller?

### B. Code Reuse (modifying constants, creating utilities)

- [ ] Searched for existing similar code before creating new?
  ```bash
  rg "pattern" src/
  ```
- [ ] If the same value repeats, does it represent one stable concept whose callers must change together? Extract only then — two literals that merely happen to match today should stay separate.
- [ ] After batch modification, all occurrences updated?

### C. Import/Dependency (creating new files)

- [ ] Correct import paths (relative vs absolute)?
- [ ] No circular dependencies?

### D. Same-Layer Consistency

- [ ] Other places using the same concept are consistent?

---

## Step 6: Report and Fix

Report every violation you find. Then:

- Mechanical and local (lint nit, missing type, wrong import, dead branch, failing assertion) → fix in place, then re-run project checks.
- Local engineering judgment within the accepted contract → resolve it with evidence and continue. A material unresolved change to scope, public behavior, ownership, risk or acceptance → record the recommendation and pause dependent work for the project's decision process.

If a fix would touch files outside the current task's scope, say so and stop instead of widening the change.
