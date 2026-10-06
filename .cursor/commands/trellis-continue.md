# Continue Current Task

Resume work on the current task — pick up at the right phase/step in `.trellis/workflow.md`.

---

## Step 1: Reuse the Checkpoint; Fill Only Missing Context

If the current conversation or compaction summary already supplies project root,
task, phase, authorization and pending action, resume that action directly. Keep
running tool handles and completed work; skip the queries below and Steps 2–4
unless a specific fact or instruction is missing/conflicting. A plain continue
does not require startup, Git/status/history or formal handoff validation.

After compaction, never repeat or re-answer the last consumed user input from
before compaction. Continue from the actual checkpoint. Handle genuinely new
post-compaction input normally.

For a fresh session, changed target, missing/conflicting facts or explicit
inspection, use the minimum query that resolves the gap:

```bash
python3 ./.trellis/scripts/task.py current --json
```

Use full `get_context.py` only when its identity/project/Git overview is needed.
Protected native writes still enforce identity, binding and ownership through
their owner; this shortcut never bypasses those checks.

Before routing by status, distinguish identity from task binding. A non-null
`session_source` confirms available identity; only `source=session:...` confirms
a direct task binding. For `unbound` / `unbound_ambiguous`, review existing task
artifacts and select by the user's explicit intent. Exit code 1 for ambiguity
does not mean identity is absent. Do not guess, duplicate tasks, invent identity,
or edit runtime pointers. Return a planning candidate to the planning gates below;
use native `task.py select <task>` to bind planning context after any required
Channel drain; use `task.py start` only when its activation contract permits it.
An eligible `analysis_only` candidate remains in planning without start.
If `session_source` is null, report unavailable identity separately.

## Step 2: Load the Phase Index Only When Needed

```bash
python3 ./.trellis/scripts/get_context.py --mode phase
```

Run only when the phase or routing rule is missing; otherwise reuse it.

## Step 3: Decide Where You Are

`get_context.py` shows the active task's `status` field. Route by `status` + artifact presence. This command replaces the user needing to remember the Trellis flow; it does not itself approve implementation.

- `status=planning` + `task.json.meta.delivery_mode = "analysis_only"` → first confirm the task still satisfies the bounded evidence-only eligibility rule; then complete the PRD's evidence work, verify its acceptance criteria and no-change boundary, and archive directly. Do not run `task.py start`; a protected-target change requires a separate change-bearing task.
- `status=planning` + no `prd.md` → **1.1** (load `trellis-brainstorm`)
- `status=planning` + a recorded `decision-needed` or unsealed decision chain → return to the planning frontier and load `pennix-decision-grill` when independent material questions can be batched.
- `status=in_progress` + a material unresolved decision → record the reason and run `task.py replan <task> "<reason>"`; do not ask a native question during implementation.
- `status=planning` + `prd.md` only → decide whether the task is lightweight or complex. Lightweight can move to **1.4** review; complex returns to **1.1** to add `design.md` + `implement.md`.
- `status=planning` + complex artifacts complete + sub-agent jsonl not curated (empty, or only a legacy `_example` placeholder row) → **1.3**
- `status=planning` + required artifacts complete + required jsonl curated or inline mode → run the Planning Seal closure pass, then **1.4**. Existing authorization must be a later explicit implementation approval for this task's current sealed material revision. Initial requests, design answers, and parent-task approval do not qualify. Use native plan seal/approve/start; ask only when that approval is missing. A replan invalidates it; minor progress edits do not.
- `status=in_progress` + implementation not started → **2.1**
- `status=in_progress` + implementation done, not yet checked → **2.2**
- `status=in_progress` + check passed → **3.3** (spec update) → **3.4** (commit)
- `status=completed` (rare; usually archived immediately) → archive flow

Phase rules (full detail in `.trellis/workflow.md`):

1. Run steps **in order** within a phase — `[required]` steps must not be skipped
2. `[once]` steps are already done if the required output exists. `prd.md` alone can be enough only for lightweight tasks; complex tasks also need `design.md` and `implement.md`.
3. You may go back to an earlier phase if discoveries require it

## Step 4: Load the Specific Step

Only if the identified step's instructions are missing:

```bash
python3 ./.trellis/scripts/get_context.py --mode phase --step <X.X> --platform cursor
```

Follow the loaded instructions. After each `[required]` step completes, move to the next.

---

## Reference

Full workflow and detailed phase steps live in `.trellis/workflow.md`. This command is only an entry point — the canonical guidance is there.
