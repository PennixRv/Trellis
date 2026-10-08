# Relation Owner Design v1

The root design is the bundle input; this document fixes this owner's contract independently.

Use channelRoot()/.session-relations.json, an ordinary hidden file outside removable Channel directories. Schema: schemaVersion, trackingSince, relations of parentSessionId/sessionId/provider=codex/firstBoundAt. Existing TRELLIS_CHANNEL_ROOT overrides isolate tests. Reuse the core file lock at .session-relations.lock and same-directory temporary-file rename; private directory/file modes 0700/0600. One minimal JSON snapshot, no database or dependency.

At the common appendEvent session_bound path, derive the exact create owner and spawned Codex provider; validate and idempotently commit the relation before committing binding completion. Duplicate same-parent sessions are no-ops; conflicting ownership, self-reference, cycles, malformed schema or write failure are errors. Preserve existing behavior for unowned/non-Codex workers.

Codex must distinguish receiving threadId from durable binding readiness. The shared stdout pipeline confirms persistence success; isReady and encodeUserMessage reject earlier use. Existing supervisor sanitized-error/shutdown handles failure, without automatic retry. Test a queued inbox message during a deliberately delayed/failed persistence to prove no turn/start escapes.

Export listSessionDescendants({ownerSessionId}) publicly from @pennixrv/trellis-core/channel. CLI: trellis channel sessions --owner-session <id> --json, no Channel/scope/project required. Default owner uses existing real Codex environment; missing identity fails. Output schemaVersion/ownerSessionId/sorted-deduplicated sessionIds/sessionCount/trackingSince/coverage. Missing file is not_started; readable store is since_activation; corrupt/inaccessible store fails. Read-only query never initializes or repairs data.

Traverse exact descendant edges, exclude owner, deduplicate actual sessions; do not remove edges on termination or cleanup. Live activity remains separately owned. Document Channel root deletion/uninstallation boundary: removing the whole root loses metadata; routine Channel cleanup retains it. New metadata is durable data, not cleanup residue.

Source targets: packages/core/src/channel/internal/store/events.ts and minimal relation module; public channel exports/API; CLI channel command registration/query; Codex adapter/readiness and stdout confirmation; owner specs and focused tests. No deep core imports from CLI.

Compatibility: existing Channel event format and worker projection stay valid; CCH requires the newly published query. Release core/CLI together on the next available beta after beta.39, through current release preflight and CI. A registry schema/interface or ownership change requires replanning; version collision alone uses the next available beta.

Rollback through native CLI install/update to beta.39, preserving new relation data; rollback lacks the new guarantee and cannot count as successful closure.
