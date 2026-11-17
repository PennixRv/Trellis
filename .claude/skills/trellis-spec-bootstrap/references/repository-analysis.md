# Repository Analysis

The goal is to discover the project's real architecture before writing rules. Do not start from generic spec templates and fill blanks. Start from the code, then let the spec structure follow.

## Analysis Order

1. Read the existing `.trellis/spec/` tree and note which files are templates, outdated, or already project-specific.
2. Inspect package manifests, build scripts, workspace config, and top-level documentation to identify packages and runtime layers.
3. Use the project's approved code intelligence tools and usable indexes for execution flows, dependency hubs, and impact-sensitive areas. Check the returned project, checkout, and freshness before relying on relationships.
4. Use available language tooling and current source for exact signatures, types, class boundaries, and implementation examples.
5. Read representative source and test files directly before turning any finding into a spec rule.

## What To Capture

| Area | Questions |
|------|-----------|
| Package boundaries | What does each package own? What imports cross boundaries? |
| Runtime layers | Which code is CLI, backend, frontend, worker, shared library, test-only, or tooling? |
| Core abstractions | Which types, services, stores, commands, routes, or adapters define the system shape? |
| Data flow | Where does user input enter, how is it validated, and where does state persist? |
| Error handling | How are failures represented, logged, surfaced, and tested? |
| Configuration | Where do defaults, environment config, generated files, and templates live? |
| Tests | Which test styles are trusted examples for new work? |

## Tool and Source Evidence

Use the host's native discovery, MCP instructions, and CLI help for the selected tool's protocol. For an approved project with a usable CodeGraph index, its native exploration can identify source spans and call paths; other approved tools may serve the same purpose. No particular tool is required by this workflow.

Start with package or symbol names, then inspect the relevant source and tests. Reuse current source spans already returned by a tool; verify omitted or stale material before making a rule. If an index is missing, stale, or bound to another checkout, record the limitation and use bounded source evidence. Do not install tools, create indexes, or query another project as a substitute for missing authorization.

## Analysis Notes

Keep short notes while analyzing. The notes should include:

- Package or layer name.
- Files that define the local pattern.
- Rules the spec should teach.
- Anti-patterns found in old code, comments, tests, or migration paths.
- Spec files that should be created, deleted, renamed, or merged.
