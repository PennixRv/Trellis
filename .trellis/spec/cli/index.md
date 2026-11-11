# CLI Guidelines

Scope: `packages/cli/` and its shipped templates; `.trellis/scripts/` mirrors
`packages/cli/src/templates/trellis/scripts/` byte for byte.

## Pre-Development Checklist

- Read [implementation guidelines](./backend/index.md) and the relevant topics.
- Read [test guidelines](./unit-test/index.md) before adding regression coverage.
- Read [shared thinking guides](../guides/index.md).

## Quality Check

Run focused Vitest coverage, then the package's `typecheck`, `lint`, `lint:py`
and `build` scripts. Broaden testing for shared generator/writer changes.
