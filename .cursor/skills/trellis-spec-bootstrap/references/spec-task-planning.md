# Spec Task Planning

Use a single agent as the default execution model. The agent may create Trellis tasks for traceability, but the skill should not require a specific platform, CLI, or parallel worker model.

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

## Optional Helper Agents

If the host supports subagents, helpers can inspect independent packages or run verification. They are optional. The main agent still owns integration and final quality.

Helper tasks must have clear ownership:

- Read-only research tasks may inspect any source needed for the assigned scope.
- Native helper write tasks require explicit project authorization and disjoint spec directories. Trellis Teamwork teammates remain in their research, review, or verification role and return findings in the assigned format; the coordinator applies accepted spec edits.
- Verification tasks should check placeholder removal, broken links, and consistency.

Do not encode helper-agent names, vendor-specific commands, or platform-specific routing in the skill. Put only the required work and acceptance criteria in the task.
