# Migration Task: Upgrade to v0.7.1-beta.14

**Created**: 2026-11-04
**From Version**: 0.7.1-beta.13
**To Version**: 0.7.1-beta.14
**Assignee**: penn

## Status

- [x] Review migration guide
- [x] Preserve existing custom config.yaml/.gitignore; no customized profile conversion needed
- [x] Apply native `trellis update --skip-all`; this version has no file migrations requiring `--migrate`
- [x] Verify native update dry-run and resolved Teamwork configuration; see migration-review.md

---

## v0.7.1-beta.14 Migration Guide

Run the native project update to refresh unmodified managed assets. Customized teammate-profiles.json files must be explicitly converted from schema 1 to schema 2: default_profile, profiles.<id>.role, default_configuration, and configurations.<name>.{provider,model,reasoning_effort,options}. Reconstruct schema-1 frozen plans from the current task inputs through teamwork plan; do not hand-edit frozen hashes or reuse uncertain attempts. Existing tasks and handoff history remain intact.

### AI Assistant Instructions

When helping with this migration:

Use the bundled trellis-teamwork Skill and teamwork config to inspect effective defaults. Review customized profile conflicts before replacement. Keep professional role cards as ordinary Trellis Markdown, preserve native provider permissions, and do not substitute interactive run/spawn or Paseo worktree delegation for managed batch execution.
