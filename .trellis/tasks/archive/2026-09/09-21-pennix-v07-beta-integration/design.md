# Pennix v0.7 Beta Reconciliation Design

## Integration Model

`pennix/v0.7-beta` is rooted directly at upstream
`be9e19b269c25cb2787489eb81062bf96619442c` (`v0.7.0-beta.4`).
`origin/main@962d8dbd` is a read-only semantic source, not a merge parent.
The old branch intermixes product behavior, generated assets, release state and
historical task material; a merge would both conflict with beta and copy
obsolete release state.

The task uses a reconciliation matrix rather than a cherry-pick list:

| Field | Meaning |
| --- | --- |
| Pennix contract | User-visible behavior to preserve, independent of old path. |
| Current owner | `0.6.45` implementation and proof. |
| Beta owner | The beta layer now responsible for that contract. |
| Disposition | Retain, beta-superseded, intentionally exclude, or relocate. |
| Landing and proof | Beta files and a focused regression or executable check. |

No capability is accepted merely because its historical commit applies cleanly.
Beta wins when it supplies the same contract with stronger safety; Pennix is
then recorded as superseded. Pennix behavior without a beta equivalent is
ported minimally at beta's current owner.

## Branches And Release

| Surface | Branch | Base | Delivery |
| --- | --- | --- | --- |
| Trellis | `pennix/v0.7-beta` | upstream `be9e19b2` | Pennix repository and npm beta prerelease |
| Marketplace | `pennix/v0.7-beta` | beta Gitlink `62a77c9b` | Pennix Marketplace, then Trellis Gitlink |

The first version is `0.7.0-beta.4.pennix.1` if available. Both packages share
the exact version and publish with npm `beta`; `latest` remains stable. A
claimed prerelease number is advanced only after querying registry state.

## Reconciliation Streams

1. **Upstream beta preservation.** Keep beta's Channel IO/JSONL repairs,
   context refresh/bounds, lifecycle receipts and path safety, ablation,
   platform/memory support, and #608 fallback semantics intact.
2. **Pennix runtime contracts.** Port package/release ownership, unbound task
   projection, continuation/ownership/recovery, Channel and managed Codex
   subnode lifecycle, telemetry, analysis-only behavior and managed assets.
   Before editing a beta symbol, run GitNexus impact and confirm unknown/dynamic
   callers through source inspection.
3. **Workflow policy.** Direct small work is only template policy:

   ```text
   no active task
     -> explicit, one-owner, bounded work with immediate focused verification
          -> proceed directly under ordinary safety rules
     -> scope/owner/design/release/durable-record uncertainty
          -> create normal or analysis-only task first
   ```

   The same wording appears in the core template and Marketplace `native`,
   `tdd`, `channel-driven-subagent-dispatch`, and `codex-subnode-channel`.
   Hooks still only inject workflow text; no new lifecycle state is introduced.
4. **Marketplace companion.** Start from the beta Gitlink, reconcile Pennix
   workflow contracts by behavior, preserve the Pennix submodule URL, verify
   templates and update behavior, push it, then move the Trellis Gitlink.
5. **Managed update and release.** Existing template hashes and `.new` sidecars
   remain the compatibility mechanism. Determine exact beta scripts from the
   package manifests; use their release path instead of inventing a second one.

## Explicit Boundaries

- No source modification in the root coordination repository.
- No forced overwrite of user project files, no rewrite of Pennix `main`, and
  no stable npm release change.
- No generic lifecycle manager, automatic retry/worker system, or direct-work
  persistence added to make this integration easier.
