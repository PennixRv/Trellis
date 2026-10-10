# Code Quality Check

Verify the task's affected behavior against the current implementation, applicable specs, and acceptance criteria.

---

## Step 1: Identify What Changed

```bash
git diff --name-only HEAD
git status
```

Use the diff as the entry point. Follow the affected behavior through existing
implementation, necessary callers, configuration, tests, documentation and
generated consumers. Expand when evidence of an existing problem could affect
the task result; do not default to a whole-module or whole-repository audit.

## Step 2: Read Task Artifacts and Applicable Specs

Read the current task artifacts in order:

- `prd.md`
- `design.md` if present
- `implement.md` if present

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
```

For each changed package/layer, read the spec index and follow its **Quality Check** section:

```bash
cat .trellis/spec/<package>/<layer>/index.md
```

Read the specific guideline files referenced — the index is a pointer, not the goal.

## Step 3: Run Project Checks

Run the project's lint, type-check, and test commands. Fix any failures before proceeding.

Choose checks by changed behavior and risk. When the task includes installation,
release or a live workflow, verify its normal entry and required endpoint;
isolated tests do not prove those endpoints. A clean bootstrap or destructive
cleanup applies only when required by the task and authorized. Reuse valid
results and distinguish checks run, not run, blocked, or limited.

## Step 4: Review Against Checklist

### Code Quality

- [ ] Linter passes?
- [ ] Type checker passes (if applicable)?
- [ ] Tests pass?
- [ ] No debug logging left in?
- [ ] No suppressed warnings or type-safety bypasses?

### Test Coverage

- [ ] Non-trivial behavior and material risks covered by meaningful checks?
- [ ] Bug fix has a regression that reaches the failing path?
- [ ] Existing tests updated when their behavior changed, without duplicating trivial implementation?

### Spec Sync

- [ ] Does `.trellis/spec/` need updates? (new patterns, conventions, lessons learned)

> "If I fixed a bug or discovered something non-obvious, should I document it so future me won't hit the same issue?" → If YES, update the relevant spec doc.

### Scope Discipline

- [ ] Any tidying of code the task did not require?
- [ ] Any abstraction, config or extension point added for a case that does not exist yet?
- [ ] Any speculative fallback for a state that cannot occur?
- [ ] Each changed file serves the task or a necessary consumer, even if the AC do not name it individually?
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
  grep -r "pattern" src/
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

Verify important findings against current requirements, actual sources, callers
and relevant counterevidence before prioritizing. Separate observed facts from
inferences; a rule's presence, a zero call count or an intentional behavior is
not by itself proof of a defect. Record task-relevant findings and their effect
on acceptance; new consequential scope choices follow the task's decision gate.

- Mechanical and local (lint nit, missing type, wrong import, dead branch, failing assertion) → fix in place, then re-run project checks.
- Design or judgment (naming a shared concept, moving a module boundary, changing a public interface, reassigning where behavior lives) → record the evidence and your recommendation, and stop. Do not rewrite it silently.

If a fix would touch files outside the current task's scope, say so and stop instead of widening the change.
