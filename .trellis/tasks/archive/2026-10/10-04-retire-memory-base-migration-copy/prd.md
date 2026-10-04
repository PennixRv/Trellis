# Remove retired memory-base names from Trellis migration metadata

## Goal

Sanitize retired external memory-base product wording from shipped Trellis migration metadata while preserving safe legacy-file cleanup behavior; release the corrected CLI/core pair and update every applicable consumer.

## Requirements

- Remove retired external memory/knowledge-base names and descriptions from the seven shipped Trellis CLI migration manifests identified by the final scan: beta.16, beta.18, beta.21, beta.22, beta.23, beta.27, and beta.28. Use neutral descriptions of the migration or compatibility purpose.
- Preserve every manifest version, schema field, migration type, target path, `allowed_hashes`, and runtime behavior. In particular, retain beta.21's hash-guarded cleanup of only the exact legacy `.trellis/agents/subnode.env` file.
- Keep Git history and archived research/tasks intact; do not preserve these retired product names in the current packaged manifest set, release notes, or active workflow source.
- Publish the corrected CLI/core pair through the native beta release and CI path, then update all seven applicable consumer roots while preserving each selected workflow and project-local state.
- Do not change Trellis CLI/core logic, introduce a memory/knowledge-base replacement, or broaden cleanup beyond the identified user-facing metadata.

## Acceptance Criteria

- [x] AC1: All seven affected manifests remain valid and preserve version/schema/migration fields, safe deletion path/hash and migration behavior; their user-facing metadata contains no retired memory-base names or descriptions.
- [x] AC2: Current source and packed beta package contain no retired memory-base references in active workflow or migration metadata; archived tasks, immutable Git history, and intentional local session-history features remain outside scope.
- [x] AC3: Release preflight, manifest continuity, build, tests, package-pair version checks, and CI publication pass for the next available beta release; both published CLI/core versions and the beta dist-tag match.
- [x] AC4: All seven consumers are updated and native workflow verification passes without changing selected workflows or overwriting protected project state; root gitlink and acceptance facts are ready for the coordinator's final `main`-only commit after this owner task is archived.
- [x] AC5: Final active-source and installed consumer scan has no retired external memory/knowledge-base entities or descriptions; exact publication/install/consumer refs and known limits are recorded, and this owner task is ready for native archive. Root final Git acceptance follows the owner archive.

## Notes

- Owner gates are complete; see `research/verification.md`. Coordinator-only root Git and cross-owner aggregation follow this task's source/receipt commit and native archive, avoiding a circular requirement that an owner archive include its own future commit hash.

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
