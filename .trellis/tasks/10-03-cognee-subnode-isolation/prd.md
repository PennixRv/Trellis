# Trellis Cognee subnode isolation

Replace the active AgentMemory child-session behavior at supervisor and Codex adapter boundaries with the authorized Cognee contract. Main sessions keep the managed Cognee path; subnodes must not inherit keys, dataset routing, plugin enablement, or watchers.

## Acceptance

- [ ] Supervisor and Codex adapter strip all `COGNEE_*` routing/secrets after environment merge and force the native Cognee plugin off for children.
- [ ] No AgentMemory executable/config/MCP path remains in active child code; historical migration manifests remain historical only.
- [ ] Main process behavior and unrelated provider/model/permission settings remain intact.
- [ ] Regression tests prove child env/config isolation and main env preservation.
- [ ] Bundled worker instructions and marketplace contract are updated through their owners, and the beta release preflight/detect-changes gates pass.

Root contract: ../../../../.trellis/tasks/10-03-cognee-memory-base-replacement.
