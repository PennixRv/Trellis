# Design: native workflow contract

## Boundary

The Marketplace `workflow.md` is the established Trellis extension point and
already resolves through `trellis init --workflow-source`. The needed behavior
is a concise project-level instruction contract, not new runtime machinery.

## Contract

The coordinator checks status then uses the provider's source hash and CAS only
at the approved semantic gates. Workers never write Briefs. For an explicitly
requested formal handoff, a valid non-drift task-local Brief is passed as a
normal explicit evidence path; it neither authorizes the handoff nor replaces
the new session's `ready -> trellis-start -> trellis-continue` validation.

## Release Shape

Commit the one Marketplace asset change and tag `v0.6.24`. Then update the
Trellis parent submodule pointer and only its existing version/release metadata
required by the repository's documented release workflow. If that workflow
cannot publish an asset-only parent patch, stop rather than adding an invented
release mechanism.

## Skill Discovery

`getBundledSkillTemplates()` and the Codex shared skill root already provide
distribution. Skill frontmatter descriptions are the platform's automatic
selection signal. Update the research-record description to cover verified
task findings produced during research, audit, or review, and point to it from
the Marketplace workflow at the same semantic boundary. Do not add a runtime
dispatcher or loosen explicit-only operations such as formal handoff.
