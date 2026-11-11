# Paseo Adapter Guidelines

Scope: `packages/paseo-adapter/`, the optional local public SDK adapter used by
Trellis worktree delegation. Package metadata and verification scripts are in
`packages/paseo-adapter/package.json`; supported operations and boundaries are
documented in `packages/paseo-adapter/README.md`.

## Pre-Development Checklist

Read the adapter README, relevant implementation and `test/*.test.js` before
changing an operation. Preserve the CLI's delegation ownership contract.

## Quality Check

Run the package's `test`, `lint`, `typecheck` and `build` scripts. The syntax
checks do not establish live Paseo service availability.
