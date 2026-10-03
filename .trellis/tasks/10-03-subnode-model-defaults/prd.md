# Refresh subnode model defaults and remove redundant code_path preset

## Goal

Update the authoritative Trellis profile template and Marketplace workflow contract to Sol/Luna defaults with eight evidence presets; verify init/update, resolver guards and native consumer previews without changing runtime mechanisms.

## Requirements

- R1: Ship default_model=gpt-6.1-sol, docs_source=gpt-5.6-luna/xhigh, six judgment profiles at high, and evidence_synthesis at medium. Remove code_path from the shipped defaults.
- R2: Align the Marketplace codex-subnode-channel workflow with those eight defaults and selection boundaries, preserving inline delivery, independent evidence, project customization, xhigh reason, deterministic resolution and fail-closed dispatch.
- R3: Preserve arbitrary project-defined IDs and customized-profile update protection. Do not blacklist code_path, extend max, change resolver/adapter behavior, add retries or replacement roles.
- R4: Verify template export, native init/update, pristine legacy replacement, customization protection, resolver guards, lint, typecheck, build, package contents and a fresh native CLI smoke.
- R5: Change sources in this repository and its Marketplace submodule. Root only records owner evidence/commits and consumes accepted owner artifacts through native commands.
- R6: Prepare reviewable local commits and consumer candidates. Remote push, release tag/CI publication and system installation remain outside current local mutation scope pending explicit authorization; do not publish npm packages locally or invent published provenance.

## Acceptance Criteria

- [x] AC1 / R1: Eight shipped profiles have Sol baseline and Luna documentation override; code_path is absent and no max default is added.
- [x] AC2 / R2: Marketplace matches the template and explains source extraction, evidence judgment, inline code lookup and xhigh selection.
- [x] AC3 / R3: Pristine legacy profiles update to the current template; project customizations and generic resolver behavior remain protected.
- [x] AC4 / R4: Relevant tests, lint, typecheck, build, artifact inclusion, native smoke and graph checks have recorded outcomes.
- [x] AC5 / R5: Consumer-only edits are retracted; sources/commits are independently reviewable, without source or runtime mirrors in root.
- [x] AC6 / R6: Local readiness is distinguished from publication, installed upgrade and root adoption; remaining native owner actions are concrete.

## Notes

- Authorization: user accepted the model recommendations and then explicitly corrected the consumer-only target on 2026-10-03. Main session implements/checks inline.
- Trellis branch/base=pennix/v0.7-beta; baseline=df66ef62d8cbbd1cefb9fb686aca1d8e2644ba63. Marketplace branch/base=main; baseline=63b57e42e7c2380b55eaf2f682e04f857c2de041. Submodule source changes belong to this explicit owner task and receive their own commit before the pointer.
- Root coordinator: /home/penn/devel/codex-workflow-optimization/.trellis/tasks/10-02-subnode-provider-config-diagnosis.
