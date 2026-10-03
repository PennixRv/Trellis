# Trellis isolation design

Keep the existing `buildChildEnvironment` and Codex config override chokepoints. After all environment sources are merged, delete every `COGNEE_*` variable and set the native plugin override to disabled for the child. Remove the legacy AgentMemory plugin/MCP overrides. Do not implement OS network isolation or a second memory client.

Use the existing adapter test fixtures and add only regression cases for inherited Cognee variables, plugin override precedence, and preservation of ordinary model/permission values. Update bundled worker guidance and marketplace workflow contracts at their real source owners.
