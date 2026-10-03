# Owner source acceptance — 2026-10-03

The CLI template and Marketplace contract now ship eight profiles: default_model=gpt-6.1-sol; docs_source=gpt-5.6-luna/xhigh; six judgment profiles=high; evidence_synthesis=medium. code_path is removed only from defaults. No production resolver/adapter functions, effort enum, permissions, retries or project-customization behavior changed.

## Scope and review

- Trellis changes: the profile JSON template, existing template/init assertions, one native update regression proving pristine legacy replacement, and this explicit task. Marketplace changes: the workflow contract and its existing contract test.
- Actual generation wiring was checked in templates/trellis/index.ts (template export and getAllAgents), configurators/workflow.ts (init) and commands/update.ts (update). The generic resolver has no code_path branch; arbitrary project-defined IDs remain supported.
- Marketplace local commit: bad3f2d683d9b022dcb882b107cf8d0921881688 on main, based on 63b57e42e7c2380b55eaf2f682e04f857c2de041. It precedes the Trellis pointer commit. Trellis base: df66ef62d8cbbd1cefb9fb686aca1d8e2644ba63 on pennix/v0.7-beta; the coordinator records the resulting source commit to avoid a self-referential hash here.

## Verification

| Check | Actual result |
|---|---|
| `pnpm --filter @pennixrv/trellis test test/templates/trellis.test.ts test/commands/init.integration.test.ts test/commands/update.integration.test.ts test/commands/channel-profiles.test.ts` | 156 passed in four files; existing customized-profile preservation remains covered. |
| Marketplace `python3 -m unittest discover -s tests -p 'test_codex_subnode_channel_workflow.py'` | 3 passed. |
| Required Trellis commit hook: full `pnpm test` | Core: 408 passed, 1 skipped, 21 files. CLI: 2186 passed, 2 skipped, 98 files. |
| `pnpm lint` and `pnpm typecheck` | Passed for core/CLI. |
| `pnpm build` | Passed; templates copied into the CLI build. |
| Package-local Prettier check of four changed CLI files | Passed; the 62 update tests passed again after formatting. |
| `npm pack --dry-run --json --ignore-scripts` in packages/cli | Built profile included at dist/templates/trellis/agents/subnode-profiles.json; no package published. |
| `node packages/cli/scripts/release-preflight.js check-versions` | Passed; CLI/core remain 0.7.0-beta.23, with no release-version bump. |
| Built native CLI `init --yes --codex --user smoke` in a fresh temporary Git project | Exit 0; generated JSON exactly matches the source, eight profiles and no code_path; the native template hash is recorded. |
| Built native CLI `update --dry-run` in that project | Exit 0; Already up to date. |
| Built resolver against the native-generated profiles | All eight model/effort resolutions passed; docs_source uses its profile model, the others use the default. Missing xhigh reason and unknown removed code_path remain rejected. |

The generated/built/source profile SHA-256 is b862bd997cb8874ae0e167ca47abcd315840e6a6102373c3e516e969f14ee8a2. The temporary project is outside all owner repositories; no generated hashes, private configuration, raw provider output or runtime data are staged.

## Graph evidence and limits

GitNexus was refreshed through native `analyze --index-only`. A fresh upstream impact query for subnodeProfilesTemplate returned UNKNOWN with zero indexed callers. It does not prove the template unused. The analysis warned about cross-language field resolution and truncated process enumeration. Native `detect-changes --scope all` reported five changed files with no indexed-symbol overlap, explicitly not a clean tree. Current source wiring, the native integration tests, package inclusion and init/update smoke supply the relevant data/template-path evidence; graph coverage is limited.

## Bounded current route checks

Two independent ephemeral/read-only Codex requests used request/stream retry limits of zero and a 40-second bound. The prompt required only OK and forbade tools. AgentMemory was disabled for these probes. Only semantic results are retained:

| Model / configured effort | Exit / answer | Elapsed | Completed tool calls |
|---|---|---:|---:|
| gpt-6.1-sol / high | 0 / OK | 8515 ms | 0 |
| gpt-5.6-luna / xhigh | 0 / OK | 5558 ms | 0 |

No HTTP/provider failure was observed. These checks prove current request routing only; they are not a role-quality benchmark, billing evidence, provider-side effective-effort measurement or full Trellis Channel recovery acceptance.

## Delivery boundary

Local source/artifact readiness is verified, including the full test suites run by the required commit hook. The next release manifest, bilingual changelogs, full release preflight, remote submodule push, release tag/CI publication, installed CLI upgrade and root native asset/workflow adoption are not completed. Root still consumes the previously published defaults and immutable Marketplace revision. No unpublished SHA has been presented as published provenance.

The remaining owner sequence is Marketplace push first, the existing CI-only Trellis beta release protocol, native Trellis lifecycle upgrade, then root native update/workflow selection with a published immutable ref and integration acceptance. The three AgentMemory/terminal-wait followup tasks remain unstarted. Do not treat route success as removing their prerequisite.
