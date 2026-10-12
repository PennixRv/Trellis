# Integrate curated methods into Trellis templates

## Goal

Apply the approved Matt Skills method fusion to common Trellis brainstorm, check, and break-loop templates.

## Background

The reviewed `PennixRv/pennix-skills-extra` fork contains reusable planning, feedback, and debugging methods. Trellis already owns the task lifecycle and generated template delivery, so the integration must add bounded method guidance at existing Trellis entry points without copying the fork or changing task ownership.

## Requirements

- R1: Strengthen `packages/cli/src/templates/common/skills/brainstorm.md` with a small, explicit route from an idea, gap, or user request to a bounded decision and implementation plan. Preserve Trellis task creation, decision-grill, approval, and analysis-only gates.
- R2: Strengthen `check.md` with a review loop that verifies the changed behavior, follows evidence to callers and acceptance, and records newly discovered consequential scope instead of silently widening the task.
- R3: Strengthen `break-loop.md` with a compact method for root cause, failed attempts, prevention, systematic expansion, and durable task/spec capture. Preserve its existing bug-analysis output and confidence guidance.
- R4: Keep the integration inline and platform-neutral. Do not add subagent dispatch, new dependencies, new runtime code, new commands, or a second lifecycle.
- R5: Update the generated template hash/manifest and validate the affected template paths, rendered output, and existing tests through the native Trellis release process.

## Acceptance Criteria

- [ ] The three common templates express the approved methods without contradictory lifecycle or ownership instructions.
- [ ] Existing planning approval, analysis-only, evidence-unit, and quality-check gates remain intact.
- [ ] Template registration, hashes, package tests, lint, typecheck, and relevant integration tests pass.
- [ ] A released Trellis CLI/core pair contains the changed templates, and a Pennix project update can materialize them without unrelated asset changes.
- [ ] The task records the commit, release, installation/update evidence, and final rollback point.

## Out of Scope

- Adding or removing Skills in `pennix-skills` or `pennix-skills-extra`.
- Changing Trellis task lifecycle semantics, subnode/channel behavior, or user-level tool routing.
- Introducing a runtime method engine, telemetry, automatic issue creation, or forced subagent use.

## Decisions

- Use the existing common template entry points as the integration surface.
- Keep provenance and upstream review data in the Pennix fork and task evidence; generated operational method text contains no commit SHA or source citation.
- Treat newly discovered consequential issues as recorded findings requiring a decision/replan, while small same-owner reversible corrections may follow the existing Trellis rule.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
