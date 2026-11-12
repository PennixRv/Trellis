---
name: trellis-spec-bootstrap
description: "Bootstrap project-specific Trellis coding specs with a platform-neutral single-agent workflow. Use when creating or refreshing .trellis/spec guidelines, analyzing a codebase with GitNexus, ABCoder, or source inspection, decomposing package/layer spec work, and writing real codebase-backed spec docs without placeholder text."
---

# Trellis Spec Bootstrap

Use this skill to create or refresh `.trellis/spec/` guidelines from the real codebase. One capable agent owns the full loop: analyze the repository, choose the spec boundaries, write the docs, and verify the result. The workflow does not depend on a specific host, CLI, or agent brand.

## Workflow

1. Reuse the current task and authorization. Inspect the current `.trellis/spec/` tree, configured package keys and spec source before changing anything. This skill does not authorize initialization, installation or indexing.
2. Analyze the repository architecture with the best available tools: GitNexus, ABCoder, language tooling, and direct source reads.
3. Decompose the spec work by package and layer only when that reflects the actual codebase.
4. Classify pure placeholders, real conventions mixed into templates, and historical examples. Fill or reshape the authorized files with concrete project evidence; preserve real rules and historical task records.
5. Verify root/package navigation, active references, applicable checks and placeholder removal. Report file preparation separately from verified conventions and remaining evidence gaps.

## Reference Routing

| Need | Read |
|------|------|
| Repository architecture analysis | [references/repository-analysis.md](references/repository-analysis.md) |
| Spec work decomposition and task planning | [references/spec-task-planning.md](references/spec-task-planning.md) |
| Writing high-signal Trellis spec files | [references/spec-writing.md](references/spec-writing.md) |
| GitNexus and ABCoder MCP setup | [references/mcp-setup.md](references/mcp-setup.md) |

## Operating Rules

- Treat templates as starting points, not contracts. Delete, rename, split, or add spec files when the repository calls for it.
- Prefer source-backed rules over generic advice. Every important recommendation should point at a real file or repeated local pattern.
- The main session owns this loop. This skill does not dispatch native helper agents or establish a collaboration route.
- Native `init` prepares missing navigation; it does not prove that spec content is useful. Ordinary existing-project reentry only repairs the missing root index, without recreating topics, guides or package mappings. An authorized source-backed refresh may still be required.
- Do not write platform-specific instructions unless the target project already standardizes on that platform.
- Do not leave placeholder text, empty headings, or copied boilerplate in `.trellis/spec/`.

## Done Criteria

- `.trellis/spec/` describes the project as it exists now.
- Each relevant package or layer has practical coding guidance with real examples.
- Non-applicable template sections are removed.
- `index.md` files match the final spec file set.
- Active task references remain valid; historical records and acceptance evidence retain their original bytes. Record deleted paths and their source commit instead of creating empty compatibility files.
- Any required setup or analysis assumptions are documented in the relevant spec or task notes.
