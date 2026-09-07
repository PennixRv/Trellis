# AGENTS And Skill Ownership Evidence

Date: 2026-09-07 (Asia/Shanghai)

## Verified Facts

- `packages/cli/src/commands/update.ts` already preserves user-authored
  `AGENTS.md` content by replacing or appending only the `TRELLIS` managed
  block. `packages/cli/src/commands/init.ts` previously skipped an existing
  file through the generic writer, so first initialization did not inject the
  block.
- The official OpenAI model guidance says models are sensitive to unclear or
  conflicting instructions loaded from `AGENTS.md` and Skills, and recommends
  auditing those artifacts. It also recommends testing only to the scope of a
  change. Source: https://developers.openai.com/api/docs/guides/latest-model
- A task-research recording instruction depends on a project-local Trellis
  task, so it belongs in a Trellis bundled Skill distributed to initialized
  projects, not in a user-level collection that also applies outside Trellis.

## Decision

Keep the user-level environment free of the live Channel rule. Deliver the
minimal project contract through the managed `AGENTS.md` block and keep the
task-recording procedure in a bundled Trellis Skill. A separate Pennix Skill
may only route a user request to native Trellis setup; it must not reproduce
the runtime contract.
