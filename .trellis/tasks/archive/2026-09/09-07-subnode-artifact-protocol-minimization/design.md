# Design: minimal protocol alignment

## Evidence and decision

The current helper requires `retry_of` and `counter_of` in every draft even
when no retry or counterwork exists. `D-03` requires those relationships only
when a consequential independent counter-review is requested. Requiring two
unrelated nulls adds schema ceremony without improving identity, containment,
or review. The helper will therefore read both fields with `dict.get()`;
present non-null values keep their existing checks.

The current non-complete report validator rejects an empty `completed_scope`.
An early worker/provider error can occur before assigned scope begins. Keeping
the field while permitting an empty list records that state accurately; the
required blocker still makes the failure explicit.

The Marketplace workflow currently says `Do not poll`. That wording conflicts
with the current contract: the coordinator must avoid high-frequency polling
while a live native wait is active, but may inspect state after wait completion
or for an on-demand diagnosis. The wording will be narrowed accordingly.

## Change boundary

Change only:

- `.trellis/scripts/subnode_artifact.py` and its shipped twin;
- its existing integration test;
- `trellis-channel/references/subnode-work.md`;
- the Pennix Marketplace `codex-subnode-channel` workflow;
- release/version metadata strictly required by the changed Marketplace and
  Trellis package.

Do not change the Channel runtime, event schema, workflow command,
`--create-new`, template hash ownership, Hook/config behavior, worker role,
or add a manifest, wrapper, scheduler, automatic retry, sandbox, or new Skill.

## Validation

The existing public CLI integration test is the regression surface. It will
exercise a relation-free ordinary draft, supplied retry/counter relations, and
an early error report. Script-tree parity verifies the shipped and dogfood
copies. A released temporary-project smoke test will verify native init,
selected Marketplace workflow, generated assets, and the source pin.
