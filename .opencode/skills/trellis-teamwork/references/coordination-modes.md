# Coordination modes

The plan's `coordination_mode` selects the call shape. It is independent from
the teammate role, execution profile, and Teamwork Session type.

All modes use the same schema-2 content report and common `--json` result
envelope. Mode selection does not waive result validation or main-agent
semantic review. It also does not transfer FIFO or process control to a model.

Project defaults live in `.trellis/teamwork.json`: general defaults to one
member, advisor to one, and committee to three. Read them with
`trellis teamwork config --mode <mode>`. The coordinator uses `defaultMembers`
when composing assignments; it must write each member explicitly. The runtime
does not invent assignments or silently duplicate one to reach the default.
Changing defaults affects only newly constructed plans. Advisor must have one
member, committee two or three, and general one or more within capacity.

## `general`

Use general coordination for one or more independent assignments. Each
assignment has its own objective, scope, lens, evidence, and acceptance
criteria. The coordinator may fill available slots in plan order and settle
each assignment independently.

## `advisor`

Use advisor coordination for one bounded consultation. The plan contains
exactly one assignment and its result is advice for the current coordinator.
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
