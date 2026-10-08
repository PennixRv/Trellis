---
description: "Guide requirements discovery for a Trellis task after task-creation consent."
---

# Trellis Brainstorm

## Non-Negotiable Planning Contract

A request to build, implement, fix, refactor, or "go ahead" is not approval to leave planning. Task-creation consent is also not implementation approval.

For every non-trivial task, the user must respond at least once after the initial request before implementation begins. If no clarification is needed, that response must approve the final planning summary described below.

Keep the task in planning while a user-owned choice needed to define the requested work remains unresolved. For `analysis_only`, findings, recommendations, and open product options do not block evidence work or require a sealed decision chain. For change-bearing work, inventory evidence and decision dependencies; batch independent material questions with `pennix-decision-grill` when useful, and do not implement or run `task.py start` until change decisions are sealed and approved.

## Analysis-Only Exception

When `task.json.meta.delivery_mode = "analysis_only"` exactly and the PRD names a bounded evidence deliverable plus a no-change boundary for product source, runtime configuration, deployment, credentials, and external systems, task-creation consent authorizes that evidence work. Keep status `planning`, record and verify the evidence, commit task artifacts, and archive directly; do not run `task.py start` or wait for a second implementation approval. This route remains eligible regardless of complexity, cross-owner scope, multiple evidence units, or whether findings include recommendations or unresolved product choices. Record these in task artifacts without changing protected targets, deploying, releasing, altering credentials, or mutating external systems. The initial request authorizes the requested main-session research; do not require a second implementation approval, Planning Seal, or `task.py start`. If independent subnode evidence is requested, freeze its dispatch plan in the task and obtain explicit approval before any spawn/send; that approval authorizes only the listed evidence dispatch. A later implementation request needs a change-bearing task and its normal Planning Seal and implementation approval gates.

## Non-Negotiable Evidence Rule

If a question can be answered by exploring the codebase, explore the codebase instead.

This is mandatory. Before asking the user a question, first check whether the answer is already available in code, tests, configs, docs, existing specs, or task history.

Do not ask the user to confirm facts that the repository can answer. Ask only for product intent, preference, scope, risk tolerance, acceptance behavior, or decisions that remain ambiguous after inspection.

Repository evidence establishes current behavior and technical constraints. The user's intended behavior, feature scope boundaries, and UX preferences are never answerable by repository evidence alone, even when an existing pattern exists; existing patterns are options and recommendation evidence, not decisions.

## Evidence Units For Read-Heavy Work

When research, audit, review, or investigation is too large for one independently useful conclusion in the current session, split it into evidence units. Each unit has one question or scope, a minimal evidence range, a destination artifact, and a stop condition; persist facts, conclusion or blocker, unknowns, and a recovery point before starting another unit. Size each unit for one normal context window without promising an exact token or time limit.

---

Use this skill during Phase 1 planning to turn the user's request into clear requirements and planning artifacts.

## Preconditions

Use this skill only after task-creation consent has been given and the user is ready to enter Trellis planning.

If no task exists yet, create one:

```bash
TASK_DIR=$({{PYTHON_CMD}} ./.trellis/scripts/task.py create "<short task title>" --description "<one-line summary>" --slug <slug>)
```

Use a concise title from the user's request. Both the title and `--description` must be non-empty — `create` rejects blanks, and a record with either one empty is refused at archive. Use a slug without a date prefix. `task.py create` adds the `MM-DD-` directory prefix automatically.

`task.py create` creates the default `prd.md`. Update that file with the current understanding before asking follow-up questions.

## Planning Flow

1. Capture the user's request and initial known facts in `prd.md`.
2. Inspect available evidence before asking questions:
   - code, tests, fixtures, and configs
   - README files, docs, existing specs, and domain notes
   - related Trellis tasks, research files, and session history when present
3. Separate what you found into:
   - confirmed facts
   - product intent still needed from the user
   - scope or risk decisions still needed from the user
   - likely out-of-scope items
4. If the requested research scope or method depends on an unresolved user-owned choice, ask only that material question; otherwise proceed with the evidence work already requested. Use `pennix-decision-grill` to batch independent choices only when needed to define the requested work. A research recommendation or open product choice can be reported as a finding without being decided or sealed for implementation.
5. If the user requests independent subnode evidence, first freeze the dispatch plan in the task: question, evidence-unit mapping and grouping rationale, brief scope/stop conditions/destinations, concurrency and FIFO refill/acceptance method. Obtain the user's explicit approval of that frozen plan before any spawn/send. This approval covers only the listed evidence dispatch; material changes to units, scope, method, owner, risk, or acceptance require reapproval. Main-session evidence work may continue while dispatch approval is pending.
6. When a needed answer returns, persist it, recheck evidence, and continue the same task.
7. For `analysis_only`, record and verify the declared evidence and no-change boundary in planning; do not require a Planning Seal, implementation approval, or `task.py start` merely because the research is complex.
8. For change-bearing work, resolve material decisions, create/update complex-task artifacts, run the requirement convergence and PRD passes, then close and present the Planning Seal. Stop before implementation. Only later explicit approval of this task's current sealed revision authorizes native plan approval and `task.py start`; material changes require `task.py replan` and approval of its newly sealed revision.

Do not invent a project-specific product/spec hierarchy. If the repository already has product, domain, or spec docs, use them. If it does not, proceed with the evidence that exists.

## Question Rules

Ask one bounded batch per message: include up to three independent material frontier questions. Ask exactly one question only when it is the sole remaining material decision or later decisions depend on its answer.

Each question must include:

- the decision needed
- why the answer matters
- your recommended answer
- the trade-off if the user chooses differently

Do not ask process questions such as whether to search, inspect files, or continue brainstorming. Do the evidence work directly. Ask the user only when the remaining issue is a product decision, preference, scope boundary, or risk tolerance choice.

Recommendations are not default selections. Never choose a recommended product decision on the user's behalf merely because the user asked for implementation.

Do not manufacture clarification questions when the request and repository evidence already resolve the scope and method. For `analysis_only`, proceed with the requested evidence work; no final implementation review or approval is required. The final review and subsequent approval are phase-transition gates for change-bearing implementation only.

## Requirement Convergence Gate

Before final review, verify all of the following:

- the user outcome and product value are explicit
- in-scope and out-of-scope behavior are explicit
- acceptance criteria describe observable outcomes
- user-owned product, scope, UX, compatibility, and risk decisions are resolved
- blocking open questions are empty
- technical unknowns are researched or explicitly deferred without changing MVP behavior

For `analysis_only`, the task PRD may stay bounded to evidence and the protected-target no-change boundary; no implementation review or approval is required. Change-bearing tasks retain their applicable evidence, convergence, final review, and fresh implementation approval gates.

The final planning summary must show Goal, In Scope, Out of Scope, Acceptance Criteria, Key Decisions, relevant Risks or Deferred Items, and artifact status.

For change-bearing work, the Planning Seal reconciles task artifacts, targets, branches, dependencies, release, validation, rollback, dynamic facts, and material decisions before implementation. It is not an eligibility or completion gate for `analysis_only` evidence work.

## Artifact Rules

`prd.md` records requirements and acceptance:

- goal and user value
- confirmed facts
- requirements
- acceptance criteria
- out of scope
- open questions that still block planning

`design.md` records technical design for complex tasks:

- architecture and boundaries
- data flow and contracts
- compatibility and migration notes
- important trade-offs
- operational or rollback considerations

`implement.md` records execution planning for complex tasks:

- ordered implementation checklist
- validation commands
- risky files or rollback points
- follow-up checks before `task.py start`

Lightweight tasks may have only `prd.md`. Complex tasks must have `prd.md`, `design.md`, and `implement.md` before `task.py start`.

`implement.md` is not a replacement for `implement.jsonl`. On sub-agent-dispatch workflows, `implement.jsonl` and `check.jsonl` must each contain at least one real spec/research entry before `task.py start`; an empty manifest, or one holding only a legacy `_example` placeholder row, does not count. Inline workflows skip this JSONL gate because Phase 2 loads context through `trellis-before-dev`.

## PRD Convergence Pass

Before declaring planning ready or running `task.py start`, rewrite `prd.md` once against the final structure described in the artifact rules above. This is not optional cleanup; it is the final planning gate.

The pass must be lossless:

- Collapse repeated facts into one authoritative section.
- Fold temporary brainstorm sections such as `What I already know`, `Assumptions`, and resolved `Open Questions` into Goal, Background, Requirements, Technical Notes, or Acceptance Criteria.
- Remove resolved open questions instead of leaving empty or already-answered sections.
- Merge parallel bug and requirement lists when they describe the same work; keep each defect's severity, evidence, and file:line anchors on the owning requirement.
- Preserve every file:line anchor, decision, constraint, requirement ID, and acceptance-criteria mapping.
- Do not proceed to final review while any blocking open question remains.

After the pass, read `prd.md` top to bottom and verify that no fact is repeated across sections unless the repetition adds new information.

## Quality Bar

Before declaring change-bearing planning ready:

- `prd.md` contains testable acceptance criteria and has passed the PRD convergence pass.
- Repository-answerable questions have been answered; blocking implementation questions are resolved.
- Complex change-bearing tasks have `design.md` and `implement.md`; sub-agent-dispatch implementation tasks have curated manifests.
- The Planning Seal and final summary cover the implementation target, validation, and rollback.
- The user subsequently approved this task's current sealed plan.

For `analysis_only`, verify the declared evidence deliverable and protected-target no-change boundary, then proceed to complete the research in planning without an implementation summary approval.

Do not start implementation merely because the user originally asked for implementation.
