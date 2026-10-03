# Preserve direct identity during unbound task recovery

## Goal

Fix Issue 181 identity loss in unbound projection and ownership recovery; publish beta.25 and verify consumers

## Requirements

- Preserve resolved direct identity in unique/ambiguous unbound projections without writing a pointer or promoting authority.
- Ownership consumes direct bindings only; candidate paths must not block a valid ready claim or make retirement appear incomplete.
- Preserve no-identity rejection, foreign-session isolation, fencing, continuity and finish safety; recovery separates identity, selection and planning activation.
- Change Python template/dogfood twins, common continue, native/Marketplace workflow text, reusable spec and necessary regressions.
- Publish locked CLI/core beta.25 through CI only; root coordinator owns full installation/adoption.

## Acceptance Criteria

- [ ] Identity/no-identity and zero/one/multiple candidate diagnostics are correct and read-only.
- [ ] Full retire/claim/consume/archive with developer backlog succeeds; fencing and unbound direct-task rejection remain effective.
- [ ] Finishing a prerequisite exposes backlog with identity intact; no stage gate is bypassed.
- [ ] Focused/full tests, lint/typecheck/Python lint/build, graph review and artifact/init smoke pass.
- [ ] Marketplace/docs are pushed before the Trellis tag; beta.25 CI/public npm and consumer adoption are recorded before closure.

## Notes

- User authorization covers implementation, release, installation and updates. Root task owns the seven-root adoption matrix.
