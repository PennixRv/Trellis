# Migration Task: Upgrade to v0.7.2-beta.2

**Created**: 2026-11-06
**From Version**: 0.7.2-beta.0
**To Version**: 0.7.2-beta.2
**Assignee**: penn

## Status

- [ ] Review migration guide
- [ ] Update custom files
- [ ] Run `trellis update --migrate`
- [ ] Test workflows

---

## v0.7.2-beta.1 Migration Guide

Upgrade through the beta channel to 0.7.2-beta.1, then run the native trellis update command. Existing customized project files remain subject to the normal preview and conflict review. Teamwork batches completed under this version now remain pending coordinator review until each report receives an explicit accepted or final_failed disposition; do not treat an AWAITING_REVIEW receipt as final acceptance. Attempt evidence remains until explicit cleanup-artifacts preview and confirmation.

### AI Assistant Instructions

When helping with this migration:

The CLI owns FIFO dispatch, retries, background monitoring, and batch recovery. Teammates submit conclusions and evidence only. After the full batch returns, the main agent reviews each report and records a disposition bound to its digest and frozen acceptance contract. Preserve attempt evidence and use native reconcile, review, retry, and cleanup-artifacts commands. Unknown process identity remains fail closed unless explicitly confirmed through the auditable native reconciliation entry point.
---

## v0.7.2-beta.2 Migration Guide

Upgrade through the beta channel to 0.7.2-beta.2, then run the native trellis update command. Existing customized project files remain subject to the normal preview and conflict review. Teamwork batches remain pending coordinator review until each report receives an explicit accepted or final_failed disposition; attempt evidence remains until explicit cleanup.

### AI Assistant Instructions

When helping with this migration:

The CLI owns FIFO dispatch, retries, background monitoring, and batch recovery. Teammates submit conclusions and evidence only. After the full batch returns, the main agent reviews each report and records a disposition bound to its digest and frozen acceptance contract. Preserve attempt evidence and use native reconcile, review, retry, and cleanup-artifacts commands. Unknown process identity remains fail closed unless explicitly confirmed through the auditable native reconciliation entry point.
