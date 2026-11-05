# Coordination modes

The plan's `coordination_mode` selects the call shape. It is independent from
the teammate role, execution profile, and Teamwork Session type.

All modes use the same schema-2 content report and common `--json` result
envelope. Mode selection does not waive result validation or main-agent
semantic review. It also does not transfer FIFO or process control to a model.

Project defaults live in `.trellis/teamwork.json`: general defaults to one
member, advisor to three, and committee to three. Schema 2 also owns the mode
concurrency limits (general 8, advisor 3, committee 3) and the shared live-process
budget (8, with 0 reserved for non-batch work). Read them with
`trellis teamwork config --mode <mode>`. The coordinator uses `defaultMembers`
when composing assignments; it must write each member explicitly. The runtime
does not invent assignments or silently duplicate one to reach the default.
Changing defaults affects only newly constructed plans. Advisor must have one to
three members, committee two or three, and general one or more within capacity.

Member count guides plan composition; concurrency limits simultaneous work.
Effective capacity is bounded by the selected mode, requested capacity, shared
live budget after reservations, and verified host capability. Existing live
workers and batch reservations share admission control. Environment overrides
are explicit and reported in `capacityPolicy.diagnostics`. Legacy schema 1 and
YAML capacity remain readable for compatibility. Schema 2 ignores legacy YAML
capacity keys with a diagnostic, so a stale YAML limit of 1 cannot silently
override the new policy. YAML retains idle-cleanup settings.

## `general`

Use general coordination for one or more independent assignments. Each
assignment has its own objective, scope, lens, evidence, and acceptance
criteria. The coordinator may fill available slots in plan order and settle
each assignment independently.

## `advisor`

Use advisor coordination for one to three bounded consultations. Each advisor
returns independent advice for the current coordinator; the default is three.
The result still carries a source digest and acceptance evidence and does not
change the task or phase by itself.

## `committee`

Use committee coordination when one question benefits from parallel distinct
lenses. The plan contains two or three assignments in one evaluation group.
All members share the assignment contract and use distinct lenses. They return
independently authored reports; the coordinator compares them after they finish.
Members may cite the same authoritative sources. Distinct lenses do not
guarantee independent evidence or require different providers, models, or profiles.

`lens` is the member's “本次关注点”, not another role directory. It is optional
in general and advisor mode. Committee members receive the same task, evidence
and acceptance contract; they must not read peer reports before submitting
their own. Profiles and configurations may differ, with a recorded selection
reason. Paseo workspace and Git worktree collaboration are independent.

Committee members do not debate with one another, run a consensus loop, or use
a directional counter relationship. If a question does not need independent
lenses, use general coordination or advisor coordination instead.
