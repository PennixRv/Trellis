# Spec Task Planning

The main session performs this work under the current task's authorization. Reuse that task when applicable; this method does not start another task system or dispatch workers.

## Decomposition

Create spec work units around real ownership boundaries:

- One package when a package has its own conventions.
- One layer when the same package has distinct frontend, backend, CLI, worker, or shared-library rules.
- One cross-cutting guide when a pattern spans packages and is not owned by one layer.

Avoid artificial decomposition. A small library usually needs one focused spec pass, not several tasks.

## Task Shape

Reuse the current task when the spec work belongs to its authorized scope. Otherwise route the request through request-intake and the project's native phases. The following is an example of useful coverage; preserve the project's actual artifact structure rather than requiring a new PRD or these exact headings:

```markdown
# Fill <package-or-layer> Trellis Specs

## Goal
Write project-specific `.trellis/spec/` guidance for <scope>.

## Scope
- Spec directory:
- Source directories to inspect:
- Tests to inspect:
- Out of scope:

## Architecture Context
Summarize the concrete findings from repository analysis.

## Files To Create Or Update
- `.trellis/spec/.../index.md`
- `.trellis/spec/.../<topic>.md`

## Rules
- Adapt the spec file set to the real codebase.
- Use real source examples with file paths.
- Remove template-only sections that do not apply.
- Do not modify product source code unless the task explicitly asks for it.

## Acceptance Criteria
- [ ] Specs contain concrete examples and anti-patterns from the repository.
- [ ] No placeholder text remains.
- [ ] Index files match the final spec files.
- [ ] Claims are backed by source files, tests, or project docs.
```

## Existing Project Refresh

Inventory the actual files before selecting changes. An old index marked `To fill` does not prove that its topic files are empty. Keep source-backed rules and their conditions, including rules mixed into placeholder headings.

Use existing package keys, `default_package` and `spec_scope`; do not infer a new map from directory names. Keep valid legacy layers when they fit. Remove pure placeholders only after checking active references and explicit authorization. Preserve archived tasks and receipts; record the source commit and exact removed paths for historical lookup.

Verify navigation and real content after edits. Missing analysis tools or source evidence must remain explicit limitations, not invented conventions. A native init/update success alone is not spec completion.
