# Analysis Tool Setup Boundaries

Spec bootstrapping uses the tools already approved and available for the target project. It does not require a particular graph, AST, MCP server, or host.

## Select Existing Capabilities

1. Confirm the project root, current checkout, host-exposed tools, and any existing indexes.
2. For an approved project with a usable CodeGraph index, follow its native MCP instructions or CLI help for source and call-path exploration. Use other approved graph, AST, or language tools when they fit the question.
3. Verify the selected tool's project binding and freshness. An ancestor index, another worktree, or a known tool name does not establish permission or coverage for this checkout.
4. Use current source and tests directly when suitable analysis tooling is unavailable; state the limitation without blocking source-backed spec work.

## Setup Requires Separate Authorization

This skill does not authorize downloading executables, installing packages, changing MCP configuration, or creating or refreshing indexes. When preparation is explicitly authorized, use the component's existing native owner and the host's supported configuration interface. Do not add a second installer or copy tool protocols into project instructions.

## Verify the Selected Surface

After an authorized setup change, confirm the actual host can discover and use the selected interface and that results identify the expected project. File existence or a successful setup command alone does not prove MCP connectivity, current indexing, or host loading.

Keep setup evidence separate from architectural conclusions. Record missing capabilities and continue with bounded source inspection when the task permits it.
