# Reduce project instruction overhead and retire GitNexus defaults

## Goal

Implement the approved root contract: shorten the native AGENTS block, retire this checkout GitNexus instructions and vendored skills, make spec bootstrap use approved available tools, verify and publish synchronized packages, refresh this checkout through the public CLI. Root owns deployment and integration; branch v0.7.1 is preserved.

## Requirements

- Follow the approved root implementation-contract.md in the parent coordination repository task project-agents-injection-optimization; this owner implements W1/W2 and its own W3 asset refresh.
- Shorten the native AGENTS block to the reviewed candidate (660 bytes before the trailing newline; at most 800), preserving startup/resume, workflow and Task CLI ownership, specs and no-hook fallback. Reuse existing skills; do not add a new skill or writer.
- Retire this checkout's two GitNexus instruction blocks, their conditional preambles, exactly 18 vendored SKILL.md files, and architect routing. Keep history and the derived index until the root's final native cleanup.
- Remove GitNexus defaults and recipes from spec-bootstrap and its references; select approved available tooling without requiring a particular product or authorizing installation/indexing.
- Preserve managed markers, manual text, other owners, custom configuration, source branch v0.7.1 and CI-only synchronized three-package publication.

## Acceptance Criteria

- [ ] The reviewed native short block and all configured platform consumers are reachable and correct; unrelated content is preserved.
- [ ] Default GitNexus routing and the exact vendored files are retired; historical records remain intact.
- [ ] Existing relevant regressions, required quality gates, package contents and isolated public-CLI generation/update/restore checks pass.
- [ ] A new immutable synchronized core/CLI/adapter release is published through CI and checked against the tested source.
- [ ] This checkout is refreshed through the accepted public CLI; owner records, commits and maintenance refs are closed out. The root owns both-host installation, probes, index cleanup and combined acceptance.

## Notes

- User approval and root contract identity are recorded in approval.md. No separate product decision or writing delegation is introduced here.
- Existing template text and documentation changes do not need mirror tests; reuse meaningful native writer/update/restore and platform regressions. Add only an uncovered behavioral case if needed.

## 验收覆盖

| 接受条件 | 工作包 | Owner | 验证入口 | 交付证据 | 停止条件 |
| --- | --- | --- | --- | --- | --- |
| Short native guidance and preserved routing | W1 | Trellis CLI | Existing generation/platform tests and isolated CLI fixture | Source, byte count, generated assets | Missing safety or discovery entry blocks acceptance |
| Exact GitNexus source integration retirement | W1 | Trellis repository | Tracked file inventory and active source scan | Exact removed files/blocks and preserved history | Unknown data or unrelated deletion blocks affected action |
| Quality and immutable public distribution | W2 | Trellis release owner | Required build/test/lint/typecheck and release preflight/CI | Source SHA, npm identities and tested package contents | Failed gates, unpublished refs or mismatched packages block publication/deployment |
| Native self-refresh and owner closeout | W3/W5 | Trellis repository | Public CLI dry-run/update and final diff | Preserved customizations, owner record and pushed refs | Unreviewed overwrite or unfinished owner work blocks closeout |
