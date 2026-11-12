# Migration Task: Upgrade to v0.7.2-beta.19

**Created**: 2026-11-12
**From Version**: 0.7.2-beta.18
**To Version**: 0.7.2-beta.19
**Assignee**: penn

## Status

- [ ] Review migration guide
- [ ] Update custom files
- [ ] Run `trellis update --migrate`
- [ ] Test workflows

---

## v0.7.2-beta.19 Migration Guide

Use native trellis update to refresh generated assets. Task runtime cleanup is preview-first and requires an exact current digest. Teamwork rm now previews by default; pass --confirm with its fresh digest to delete. prune --yes also requires --confirm. create --force no longer wipes nonempty sessions. No private task or handoff history is deleted or migrated automatically. Incomplete process proof and unknown references retain their assets.

### AI Assistant Instructions

When helping with this migration:

Preserve current task and handoff authority. Inspect native previews, accepted evidence, live processes and recovery obligations before proposing exact cleanup objects. Do not infer expiry from age, delete fixed lock anchors, hand-edit runtime state, or use create --force as a cleanup bypass. Obtain explicit approval for actual historical data deletion.
