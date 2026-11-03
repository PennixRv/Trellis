# MCP Setup

GitNexus and ABCoder are recommended when bootstrapping Trellis specs because they expose architecture and AST context to the agent. They are tool choices, not platform requirements. Configure them through whatever MCP mechanism your agent host provides.

First discover the project's approved, available tools and existing indexes. Use source and tests directly when no suitable index is available; record that limit. Spec bootstrapping does not authorize installing tools, configuring MCP servers, downloading executables, or creating or refreshing indexes. The setup examples below apply only after those operations have separate authorization and the target repository is explicit. Prefer an already installed, pinned owner entry point over an unpinned download.

## GitNexus

GitNexus builds a code knowledge graph from the repository. Use it for module boundaries, execution flows, dependency relationships, blast radius, and graph queries.

### Install and Index

```bash
# Run from the repository root.
npx gitnexus analyze

# Check index status.
npx gitnexus status

# Re-index only when explicitly authorized for this repository.
npx gitnexus analyze
```

The index is written to `.gitnexus/`. Keep embeddings only if the project already uses them; otherwise a normal index is enough for spec bootstrapping.

### MCP Server Command

Use this server command in the host's MCP configuration:

```bash
npx -y gitnexus mcp
```

### Useful Tools

| Tool | Purpose |
|------|---------|
| `gitnexus_query` | Find execution flows and functional areas by concept |
| `gitnexus_context` | Inspect callers, callees, references, and process participation for a symbol |
| `gitnexus_impact` | Understand blast radius before changing a symbol |
| `gitnexus_detect_changes` | Check changed symbols and affected flows before finishing |
| `gitnexus_cypher` | Run direct graph queries |
| `gitnexus_list_repos` | List indexed repositories |

## ABCoder

ABCoder parses code into UniAST and gives precise package, file, and node-level structure. Use it for signatures, type shapes, implementations, dependencies, and reverse references.

### Install

```bash
go install github.com/cloudwego/abcoder@latest
abcoder --help
```

### Parse Repositories

```bash
abcoder parse /absolute/path/to/package \
  --lang typescript \
  --name package-name \
  --output ~/abcoder-asts
```

For monorepos, parse each package with a stable `--name` so task notes can reference the same repository names.

### MCP Server Command

Use this server command in the host's MCP configuration:

```bash
abcoder mcp ~/abcoder-asts
```

### Useful Tools

| Tool | Layer | Purpose |
|------|-------|---------|
| `list_repos` | 1 | List parsed repositories |
| `get_repo_structure` | 2 | Inspect packages and files |
| `get_package_structure` | 3 | Inspect nodes within a package |
| `get_file_structure` | 3 | Inspect functions, classes, types, and signatures in a file |
| `get_ast_node` | 4 | Retrieve code, dependencies, references, and implementations |

## Verification

After an authorized configuration change, verify the selected MCP server from the agent host and run a simple query. Neither server is mandatory; unavailable tooling does not block a source-backed spec pass.

```bash
ls .gitnexus/meta.json
ls ~/abcoder-asts/*.json
```
