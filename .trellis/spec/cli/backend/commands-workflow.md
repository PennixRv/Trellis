---
name: commands-workflow
description: Bundled native and explicitly sourced custom workflows, local workflow switching, and hash ownership
paths:
  - packages/cli/src/commands/workflow.ts
  - packages/cli/src/utils/workflow-resolver.ts
---
# `trellis workflow` Command

`trellis workflow` lists and switches the project's active `.trellis/workflow.md`.
The bundled native workflow is the only default workflow source. A custom
workflow is resolved only when the user explicitly supplies
`--workflow-source <source>`; it is an independent extension path and is not
part of the default workflow route or release dependency.

`--save <id>` writes to the per-task variant library
(`.trellis/workflows/<id>.md`) without changing the active workflow. The local
workflow selection rules remain in `workflow-state-contract.md`.

## Scope and CLI

This contract applies to `commands/workflow.ts`, `utils/workflow-resolver.ts`,
workflow selection in `commands/init.ts`, `configurators/workflow.ts`, and
their tests. Trellis does not maintain a Marketplace checkout or workflow
mirror. Generic registry-backed spec-template downloads are a separate feature.

```text
trellis workflow
trellis workflow --list [--workflow-source <source>]
trellis workflow --template <id> [--workflow-source <source>]
trellis workflow --template <id> --force
trellis workflow --template <id> --create-new
trellis workflow --save <id> [--workflow-source <source>] [--force]
trellis workflow create <id> [--skip-defaults]

trellis init --workflow <id>
trellis init --workflow-source <source> --workflow <id>
```

The resolver exposes only bundled content by default:

```typescript
export const NATIVE_WORKFLOW_ID = "native";

export interface WorkflowResolveOptions {
  source?: string;
}

export interface ResolvedWorkflowTemplate {
  id: string;
  type: "workflow";
  name: string;
  description?: string;
  path: string;
  content: string;
  source: "bundled" | "custom";
}

export interface WorkflowTemplateListing {
  id: string;
  type: "workflow";
  name: string;
  description?: string;
  path: string;
  source: "bundled" | "custom";
}

export function listWorkflowTemplates(options?: WorkflowResolveOptions):
  Promise<{ templates: WorkflowTemplateListing[]; errorMessage?: string }>;

export function resolveWorkflowTemplate(
  id: string,
  options?: WorkflowResolveOptions,
): Promise<ResolvedWorkflowTemplate>;
```

## Resolution and ownership

- `native` resolves to `packages/cli/src/templates/trellis/workflow.md` without
  network access. Listing without an explicit source returns only `native`.
- A non-native id requires an explicit custom source. The resolver reads its
  `index.json`, selects an entry with `type: "workflow"`, then fetches that
  entry's Markdown file. A custom source is never inferred or selected by
  default.
- Listing with an explicit source includes its workflow entries and retains
  the bundled `native` entry if the source cannot be reached. Resolution errors
  identify workflow lookup or download failures.
- The source marker is `"bundled"` for `native` and `"custom"` for explicitly
  sourced entries.
- After writing `native` to `.trellis/workflow.md`, refresh that file's hash in
  `.trellis/.template-hashes.json`. After writing any non-native template,
  remove the active workflow's hash so `trellis update` treats it as
  user-managed content.
- Do not add persistent configuration that makes `trellis update` select a
  workflow variant. A switch is explicit. Per-task workflow selection remains
  task-scoped state.
- `--save <id>` writes only `.trellis/workflows/<id>.md`; it does not change the
  active workflow or its hash. Library files are user-managed and untouched by
  `trellis update`.
- Library ids match `^[A-Za-z0-9_-]+$`, consistent with per-task resolution.
  Existing files require `--force` to overwrite with `--save`; the active
  workflow write modes cannot be combined with `--save`.
- `workflow create <id>` copies the bundled native workflow to the library,
  refuses an existing file, and leaves the active workflow and hash unchanged.
  In an interactive terminal it asks whether to set project and personal
  defaults, in that order; both default to no. `--skip-defaults` or non-TTY
  execution creates only the library file.
- `--save` warns on stderr if the written content lacks runtime parser markers;
  it still succeeds. Warnings do not mix with stdout command results.

## Parser and error behavior

Workflow files consumed by runtime parsers retain the phase index, numbered
step headings, platform markers, and required `[workflow-state:*]` blocks.
Session hooks, workflow-state injection, `trellis-start`, and
`get_context.py --mode phase` use the task-selected library variant when one is
present, otherwise `.trellis/workflow.md`; see `workflow-state-contract.md`.

| Condition | Behavior |
|---|---|
| `--template <id>` targets a modified active workflow | Fail with guidance to use `--force` or `--create-new`; do not prompt |
| Interactive picker targets a modified active workflow | Offer overwrite, create-new, or skip |
| `--create-new` | Write the resolved content beside the active workflow as `workflow.md.new`; leave active content and hash unchanged |
| Custom id has no explicit source | Fail with a workflow-specific error |
| Custom source index is unavailable | Listing retains `native` and reports a warning; resolving a custom id fails |
| Workflow entry path is absolute, escapes its source, or is not Markdown | Fail with a workflow-specific error |
| `init --workflow <unknown-id>` | Reject initialization rather than return success |
| `--save` id is invalid or its destination exists without `--force` | Fail before writing; preserve existing content |
| `--save` combines with `--template` or `--create-new` | Fail without writing |
| `trellis update` follows a non-native switch or saved library file | Preserve the user-managed workflow content |

## Validation

Resolver and integration tests cover bundled offline resolution, native-only
default listing, explicit custom-source resolution, missing ids, unsafe paths,
active workflow hash ownership, modified-file handling, library writes, and
native scaffolding. No test or runtime path depends on a local Marketplace
checkout or a bundled remote-workflow mirror.

When the bundled native workflow changes, verify its generated package copy and
the behavior of `init`, `workflow --template native`, and `trellis update`.
