# Teammate profiles and runtime

## One generic role contract

The only bundled role card is `.trellis/agents/teammate.md`. It is the shared instruction injected for every teammate. It limits work to investigation, research, review, verification, and assigned evidence/report writing; product source and Git state stay read-only. Do not create specialist cards or use the CLI's native nested-agent feature.

The role card defines behavior. A profile selects execution settings; it does not create a different role:

- `.trellis/agents/teammate-profiles.json` contains optional `default_provider`, `default_model`, and a `profiles` map.
- Each profile can select `provider`, `model`, `reasoning_effort`, and provider-specific `options`.
- Explicit command or frozen-plan values override profile values; profile values override file defaults.
- The current contract providers are Codex app-server, DSH ACP, Copilot ACP, and Claude Code CLI. A provider contract is not proof that its external host is installed or verified.

The batch host gate must prove that the selected provider preserves the frozen prompt/context, disables native and recursive delegation, keeps protected targets and Git state read-only, and supports the required lifecycle. Missing or changed proof fails closed.

## Batch execution

Use the batch plan and report schema in `teammates.md`. Once accepted by the CLI, the program owns execution, slot reuse, bounded retry decisions, report validation, and the terminal receipt. The coordinating agent waits for that receipt and does not issue individual send/wait/interrupt commands to steer the batch.

The current checkout has provider contracts and capability snapshots, but no verified external host gate. Therefore `trellis teamwork batch <plan>` refuses before writing coordination state. Do not work around this by manually starting the same units.

## Existing single-process commands

The public command reference documents `teamwork spawn`, `teamwork run`, and process inspection controls retained from Core Channel. They are low-level single-process operations; they do not replace the fixed-batch coordinator or authorize a second scheduling loop. Use them only for an explicitly planned one-shot or runtime recovery that does not overlap a managed batch.

Every launched process receives the generic teammate role and its selected profile. Store assigned reports only at the paths in the frozen task plan. Do not write implementation files or Git metadata.
