# Reconciliation Baseline

## Verified Refs on 2026-09-21

```text
upstream main:             e77ae89f648a78d5859fa2e8ac314655898421a5
upstream feat/v0.7-beta:   be9e19b269c25cb2787489eb81062bf96619442c
upstream beta tag:         v0.7.0-beta.4 -> be9e19b2
Pennix main:               962d8dbdc58e3ce058139dd952756f52d7adac85
Pennix stable tag:         v0.6.45 -> 962d8dbd
Pennix feat/v0.7-beta:     82e0013732de4557a7d110a427223275d0fbacca
upstream beta Marketplace: 62a77c9b57fb8bb081c110394bce08b6ebc6e09a
Pennix Marketplace main:   b61a2d2ae97064a1cab12b26bab45b69c159d22f
```

The local Trellis checkout originally had `main@7012cd8a` and Marketplace
`main@a3b4454`. Both were verified ancestors of their respective remote mains,
with no local-only source commits on any local branch. They are now fast-
forwarded to `962d8dbd` and `b61a2d2`. This task branch remains rooted at
upstream beta and has no unmerged local product source.

## Why a New Beta Line

Pennix main diverged from upstream after `88f4834449da9b4f607ec05e322408a0aa66f2ce`.
The 113 Pennix-only commits changed 378 files and contain behavior alongside
old release state and task history. An isolated beta merge tree conflicted in
active-task resolution, workflow state, templates, package manifests, shared
subagent context, tests, memory exports and Marketplace. The right procedure is
therefore semantic reconciliation on beta, not branch merge.

## Capability Groups

| Pennix contract | Required disposition |
| --- | --- |
| `@pennixrv/*` package/release identity | Retain with beta manifests. |
| Governed Channel startup/spawn/wait and Codex routing | Retain after beta Channel reconciliation. |
| Managed Codex subnode workflow/project instructions | Retain in beta Marketplace templates. |
| Continuation, ownership, sealed handoff and recovery | Retain at beta lifecycle owners. |
| Subnode lifecycle, terminal reports and telemetry | Retain against beta event/runtime APIs. |
| Analysis-only direct research completion | Retain. |
| Issue 180 unbound task projection | Retain atop upstream #608. |
| Template/release continuity | Retain intent, regenerate beta assets/tests. |
| Old manifests, journals, task archives, incidental docs | Exclude unless independently needed. |

## Direct Small Work

Pennix's `codex-subnode-channel` no-task breadcrumb currently says `Do not
implement`. That template policy, rather than resolver or Hook behavior, blocked
an explicit one-service Compose correction. The minimal fix is shared workflow
prose that permits only explicit, bounded, one-surface work with immediate
verification and escalates for multi-repository/owner, design, release,
credential, durable-record or scope-growth cases.

## Evidence

- `git ls-remote https://github.com/mindfold-ai/Trellis.git refs/heads/main refs/heads/feat/v0.7-beta refs/tags/v0.7.0-beta.4`
- `git ls-remote origin refs/heads/main refs/heads/feat/v0.7-beta refs/tags/v0.6.45`
- Root archived audit: `/home/penn/devel/codex-workflow-optimization/.trellis/tasks/archive/2026-09/09-21-trellis-beta-fork-reconciliation-research/`
