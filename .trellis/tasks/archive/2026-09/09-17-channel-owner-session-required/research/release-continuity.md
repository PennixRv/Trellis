## Release Continuity Recovery

`pnpm release` initially stopped before versioning because the public npm
registry contained `@pennixrv/trellis@0.6.35` while the source tree had no
`src/migrations/manifests/0.6.35.json`.

Evidence verified before repair:

- Commit `b582978a` (`0.6.35`) changes only the CLI and core package versions.
- The published `0.6.35` tarball (integrity
  `sha512-IHeDNM56Zd9vgbOrORdOfRrFF6XCu6FyaF6Rn8aaQw/PatDyUyEan+R8OCArgVmYXmAFAfVCFJ4ObmV0PuMLtw==`)
  contains `dist/migrations/manifests/0.6.34.json` but no `0.6.35.json`.
- Therefore the restored `0.6.35` manifest is non-breaking with an empty
  migration list. It records the version-only release without retroactively
  changing any project migration.

The continuity guard was not bypassed. After adding the manifest,
`check-manifest-continuity.js` reported 166 local manifests and 18 published
versions with no new gaps.
