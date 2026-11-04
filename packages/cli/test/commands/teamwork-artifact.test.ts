import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  installTeammateAssets,
  frozenExecution,
} from "../helpers/teammate-assets.js";

import {
  computeTeamworkPlanHash,
  appendTeammateWorklog,
  assertTeammateWriteAllowed,
  writeTeammateQueueFact,
  writeTeammateReport,
  validateTeammateClaim,
  validateTeammateQueueFact,
  validateTeamworkPlan,
  validateTeammateDisposition,
  validateTeammateReport,
} from "../../src/commands/teamwork/artifact.js";

const sourceDigest = "a".repeat(64);

it("accepts a report authored from the bundled teammate role example", () => {
  const role = fs.readFileSync(
    path.resolve(__dirname, "../../src/templates/trellis/agents/teammate.md"),
    "utf8",
  );
  const example = /```json\s*([\s\S]*?)```/.exec(role)?.[1];
  if (!example)
    throw new Error("bundled teammate role must include a JSON report example");
  const report = JSON.parse(example);
  const assigned = {
    task_id: "task-1",
    batch_id: "batch-1",
    assignment_id: "work-1",
    attempt_id: "attempt-1",
    teammate_id: "teammate-1",
    plan_hash: "b".repeat(64),
    phase_id: "decision_space_construction_and_merging",
    task_route_revision: "2",
    input_revision: "3",
    source_digest: sourceDigest,
  };
  for (const [key, value] of Object.entries(assigned)) {
    if (key in report) report[key] = value;
  }
  report.evidence = [
    {
      id: "finding-1",
      locator: "src/contract.ts",
      summary: "The assigned contract is consistent.",
    },
  ];
  const identity = {
    taskId: assigned.task_id,
    batchId: assigned.batch_id,
    assignmentId: assigned.assignment_id,
    attemptId: assigned.attempt_id,
    teammateId: assigned.teammate_id,
    planHash: assigned.plan_hash,
    phaseId: assigned.phase_id,
    taskRouteRevision: assigned.task_route_revision,
    inputRevision: assigned.input_revision,
  };
  expect(validateTeammateReport(report, identity, sourceDigest).status).toBe(
    "complete",
  );
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-artifact-test-"));
  installTeammateAssets(root);
  const execution = frozenExecution(root);
  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const briefPath = path.join(
    root,
    "teammates",
    "batch-1",
    "work-1",
    "brief.json",
  );
  fs.mkdirSync(path.dirname(briefPath), { recursive: true });
  const brief = {
    schema_version: 2,
    input: "Inspect the assigned source and return cited findings.",
    task_id: "task-1",
    batch_id: "batch-1",
    assignment_id: "work-1",
    execution,
    profile: "review",
    model: execution.profile.model,
    selection_reason: "Independent review using the configured default",
    provider: "codex",
    summary: "Check the source contract and report concrete evidence.",
    scope: "Inspect the source contract",
    lens: "Find mismatches and cite evidence",
    deadline,
    source_digest: sourceDigest,
    acceptance: ["Cite the inspected evidence"],
  };
  fs.writeFileSync(briefPath, JSON.stringify(brief));
  const plan: Record<string, unknown> = {
    schema_version: 2,
    coordination_digest: "c".repeat(64),
    task_id: "task-1",
    batch_id: "batch-1",
    session_id: "parallel",
    phase_id: "decision_space_construction_and_merging",
    task_route_revision: "1",
    input_revision: "1",
    plan_summary: "Inspect the source contract.",
    coordination_mode: "general",
    assignments: [
      {
        assignment_id: "work-1",
        brief_path: "teammates/batch-1/work-1/brief.json",
        execution,
        profile: brief.profile,
        model: brief.model,
        selection_reason: brief.selection_reason,
        provider: "codex",
        summary: brief.summary,
        scope: brief.scope,
        lens: brief.lens,
        brief_digest: computeTeamworkPlanHash(brief),
        source_digest: sourceDigest,
        acceptance: ["Cite the inspected evidence"],
        max_retries: 1,
      },
    ],
    protected_targets: ["src/"],
    deadline,
  };
  plan.plan_hash = computeTeamworkPlanHash(plan);
  return { root, plan };
}

function addPairedWork(
  root: string,
  plan: Record<string, unknown>,
  relation: "committee",
  options: { lens?: string; summary?: string } = {},
) {
  const work = plan.assignments as Record<string, unknown>[];
  const primary = work[0];
  if (!primary) throw new Error("fixture is missing primary work");
  const primaryBriefPath = path.join(root, String(primary.brief_path));
  const primaryBrief = JSON.parse(
    fs.readFileSync(primaryBriefPath, "utf8"),
  ) as Record<string, unknown>;
  const group = { id: "review-pair", kind: "committee" };
  const secondBrief = {
    ...primaryBrief,
    assignment_id: "work-2",
    provider: "claude",
    execution: frozenExecution(root, "claude"),
    lens: options.lens ?? "Check assumptions and independent evidence",
    ...(options.summary ? { summary: options.summary } : {}),
  };
  const secondBriefPath = path.join(
    root,
    "teammates",
    "batch-1",
    "work-2",
    "brief.json",
  );
  fs.mkdirSync(path.dirname(secondBriefPath), { recursive: true });
  fs.writeFileSync(secondBriefPath, JSON.stringify(secondBrief));
  const secondWork: Record<string, unknown> = {
    ...primary,
    assignment_id: "work-2",
    brief_path: "teammates/batch-1/work-2/brief.json",
    provider: "claude",
    execution: secondBrief.execution,
    lens: secondBrief.lens,
    brief_digest: computeTeamworkPlanHash(secondBrief),
    ...(options.summary ? { summary: options.summary } : {}),
  };
  if (options.summary) {
    secondWork.summary = options.summary;
  }
  if (relation === "committee") {
    primary.evaluation_group = group;
    secondWork.evaluation_group = group;
  }
  fs.writeFileSync(primaryBriefPath, JSON.stringify(primaryBrief));
  primary.brief_digest = computeTeamworkPlanHash(primaryBrief);
  work.push(secondWork);
  plan.coordination_mode = "committee";
  plan.plan_hash = computeTeamworkPlanHash(plan);
  return { primary, secondWork, primaryBrief, secondBrief };
}

describe("TeamworkSession teammate artifacts", () => {
  it("binds the immutable plan hash to the brief source digest", () => {
    const { root, plan } = fixture();
    expect(validateTeamworkPlan(plan, root).assignments[0].sourceDigest).toBe(
      sourceDigest,
    );
    (plan.assignments as Record<string, unknown>[])[0].source_digest =
      "b".repeat(64);
    plan.plan_hash = computeTeamworkPlanHash(plan);
    expect(() => validateTeamworkPlan(plan, root)).toThrow(/source_digest/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects a symlinked brief path before reading outside the task root", () => {
    const { root, plan } = fixture();
    const teammates = path.join(root, "teammates");
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "trellis-artifact-outside-"),
    );
    fs.rmSync(teammates, { recursive: true, force: true });
    fs.symlinkSync(outside, teammates, "dir");
    expect(() => validateTeamworkPlan(plan, root)).toThrow(/symlink/);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("rejects a modified immutable brief even when the plan itself is unchanged", () => {
    const { root, plan } = fixture();
    const brief = path.join(
      root,
      "teammates",
      "batch-1",
      "work-1",
      "brief.json",
    );
    const value = JSON.parse(fs.readFileSync(brief, "utf8")) as Record<
      string,
      unknown
    >;
    value.scope = "Changed after plan freeze";
    fs.writeFileSync(brief, JSON.stringify(value));
    expect(() => validateTeamworkPlan(plan, root)).toThrow(/brief.*digest/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("requires a bounded summary in the frozen plan and matching brief", () => {
    const { root, plan } = fixture();
    const work = (plan.assignments as Record<string, unknown>[])[0];
    delete work.summary;
    plan.plan_hash = computeTeamworkPlanHash(plan);
    expect(() => validateTeamworkPlan(plan, root)).toThrow(/summary/);

    work.summary = "A different summary";
    plan.plan_hash = computeTeamworkPlanHash(plan);
    expect(() => validateTeamworkPlan(plan, root)).toThrow(/brief.*summary/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("validates committee pairs while allowing different providers", () => {
    const { root, plan } = fixture();
    addPairedWork(root, plan, "committee");
    const [first, second] = validateTeamworkPlan(plan, root).assignments;
    expect(first?.evaluationGroup).toEqual({
      id: "review-pair",
      kind: "committee",
    });
    expect(second?.provider).toBe("claude");

    const work = plan.assignments as Record<string, unknown>[];
    const secondWork = work[1];
    const firstWork = work[0];
    if (!secondWork || !firstWork)
      throw new Error("fixture is missing a pair member");
    const secondBriefPath = path.join(root, String(secondWork.brief_path));
    const secondBrief = JSON.parse(
      fs.readFileSync(secondBriefPath, "utf8"),
    ) as Record<string, unknown>;
    secondWork.lens = firstWork.lens;
    secondBrief.lens = secondWork.lens;
    fs.writeFileSync(secondBriefPath, JSON.stringify(secondBrief));
    secondWork.brief_digest = computeTeamworkPlanHash(secondBrief);
    plan.plan_hash = computeTeamworkPlanHash(plan);
    expect(() => validateTeamworkPlan(plan, root)).toThrow(/distinct lenses/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects incomplete and mismatched committee work contracts", () => {
    const incomplete = fixture();
    const incompleteWork = (
      incomplete.plan.assignments as Record<string, unknown>[]
    )[0];
    if (!incompleteWork) throw new Error("fixture is missing primary work");
    incomplete.plan.coordination_mode = "committee";
    incompleteWork.evaluation_group = {
      id: "review-pair",
      kind: "committee",
    };
    incomplete.plan.plan_hash = computeTeamworkPlanHash(incomplete.plan);
    expect(() =>
      validateTeamworkPlan(incomplete.plan, incomplete.root),
    ).toThrow(/two or three/);
    fs.rmSync(incomplete.root, { recursive: true, force: true });

    const mismatched = fixture();
    addPairedWork(mismatched.root, mismatched.plan, "committee", {
      summary: "A different objective",
    });
    expect(() =>
      validateTeamworkPlan(mismatched.plan, mismatched.root),
    ).toThrow(/same assignment contract/);
    fs.rmSync(mismatched.root, { recursive: true, force: true });
  });

  it("writes queue, worklog and report artifacts with create-once report semantics", () => {
    const { root, plan } = fixture();
    const work = validateTeamworkPlan(plan, root).assignments[0];
    writeTeammateQueueFact({
      taskRoot: root,
      briefPath: work.briefPath,
      taskId: "task-1",
      batchId: "batch-1",
      assignmentId: work.assignmentId,
      planHash: computeTeamworkPlanHash(plan),
      briefDigest: work.briefDigest,
      sourceDigest,
      queueIndex: 0,
    });
    const queue = JSON.parse(
      fs.readFileSync(
        path.join(root, "teammates", "batch-1", "work-1", "queue.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(queue).toMatchObject({ status: "queued", queue_index: 0 });
    expect(() =>
      validateTeammateQueueFact(
        queue,
        { taskId: "task-1", batchId: "batch-1", assignmentId: "work-1" },
        computeTeamworkPlanHash(plan),
        "c".repeat(64),
        sourceDigest,
      ),
    ).toThrow(/brief digest/);
    appendTeammateWorklog({
      taskRoot: root,
      briefPath: work.briefPath,
      attemptId: "work-1.attempt.0",
      checkpoint: "Inspected the assigned files.",
    });
    const identity = {
      taskId: "task-1",
      batchId: "batch-1",
      assignmentId: "work-1",
      attemptId: "work-1.attempt.0",
      teammateId: "work-1.teammate.0",
      planHash: "b".repeat(64),
      phaseId: "decision_space_construction_and_merging",
      taskRouteRevision: "1",
      inputRevision: "1",
    };
    const report = {
      taskRoot: root,
      briefPath: work.briefPath,
      identity,
      sourceDigest,
      status: "complete" as const,
      evidence: [
        { id: "e1", locator: "src/example.ts:1", summary: "Observed." },
      ],
    };
    writeTeammateReport(report);
    expect(() => writeTeammateReport(report)).toThrow(/already exists/);
    expect(() => assertTeammateWriteAllowed("src/example.ts", ["src"])).toThrow(
      /protected/,
    );
    expect(() =>
      assertTeammateWriteAllowed("docs/example.md", ["src"]),
    ).not.toThrow();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("accepts only a complete report with matching identity and evidence", () => {
    const report = {
      schema_version: 1,
      task_id: "task-1",
      batch_id: "batch-1",
      assignment_id: "work-1",
      attempt_id: "work-1.attempt.0",
      teammate_id: "work-1.teammate.0",
      plan_hash: "b".repeat(64),
      phase_id: "decision_space_construction_and_merging",
      task_route_revision: "1",
      input_revision: "1",
      status: "complete",
      source_digest: sourceDigest,
      evidence: [
        { id: "e1", locator: "src/example.ts:1", summary: "Observed." },
      ],
    };
    expect(
      validateTeammateReport(
        report,
        {
          taskId: "task-1",
          batchId: "batch-1",
          assignmentId: "work-1",
          attemptId: "work-1.attempt.0",
          teammateId: "work-1.teammate.0",
          planHash: "b".repeat(64),
          phaseId: "decision_space_construction_and_merging",
          taskRouteRevision: "1",
          inputRevision: "1",
        },
        sourceDigest,
      ).status,
    ).toBe("complete");
    expect(() =>
      validateTeammateReport(
        { ...report, status: "blocked" },
        {
          taskId: "task-1",
          batchId: "batch-1",
          assignmentId: "work-1",
          attemptId: "work-1.attempt.0",
          teammateId: "work-1.teammate.0",
          planHash: "b".repeat(64),
          phaseId: "decision_space_construction_and_merging",
          taskRouteRevision: "1",
          inputRevision: "1",
        },
        sourceDigest,
      ),
    ).toThrow(/cannot be accepted/);
  });

  it("binds claim and disposition records to the attempt identity", () => {
    const identity = {
      taskId: "task-1",
      batchId: "batch-1",
      assignmentId: "work-1",
      attemptId: "work-1.attempt.0",
      teammateId: "work-1.teammate.0",
    };
    const planHash = "b".repeat(64);
    expect(
      validateTeammateClaim(
        {
          schema_version: 2,
          task_id: "task-1",
          batch_id: "batch-1",
          assignment_id: "work-1",
          attempt_id: "work-1.attempt.0",
          teammate_id: "work-1.teammate.0",
          plan_hash: planHash,
          source_digest: sourceDigest,
          slot: 1,
          status: "issued",
        },
        identity,
        planHash,
        sourceDigest,
      ).slot,
    ).toBe(1);
    expect(() =>
      validateTeammateDisposition(
        {
          schema_version: 1,
          task_id: "task-1",
          batch_id: "batch-1",
          assignment_id: "work-1",
          attempt_id: "work-1.attempt.0",
          teammate_id: "work-1.teammate.0",
          status: "final_failed",
          source_digest: sourceDigest,
        },
        identity,
        sourceDigest,
      ),
    ).toThrow(/requires a reason/);
  });

  it("bounds claim options and rejects credential-like values", () => {
    const identity = {
      taskId: "task-1",
      batchId: "batch-1",
      assignmentId: "work-1",
      attemptId: "work-1.attempt.0",
      teammateId: "work-1.teammate.0",
    };
    const planHash = "b".repeat(64);
    const makeClaim = (options: Record<string, string | number | boolean>) => ({
      schema_version: 2,
      task_id: identity.taskId,
      batch_id: identity.batchId,
      assignment_id: identity.assignmentId,
      attempt_id: identity.attemptId,
      teammate_id: identity.teammateId,
      plan_hash: planHash,
      brief_digest: "c".repeat(64),
      source_digest: sourceDigest,
      slot: 0,
      status: "issued",
      configuration: "codex-sol",
      provider: "codex",
      options,
      role_digest: planHash,
      context_digest: planHash,
      capability_digest: planHash,
    });
    const validate = (options: Record<string, string | number | boolean>) =>
      validateTeammateClaim(
        makeClaim(options),
        identity,
        planHash,
        sourceDigest,
        "c".repeat(64),
      );

    expect(() => validate({ temperature: Number.POSITIVE_INFINITY })).toThrow(
      /bounded scalar/,
    );
    expect(() => validate({ token: "Bearer secret-value" })).toThrow(
      /credential/,
    );
    expect(() =>
      validate(
        Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, i])),
      ),
    ).toThrow(/too many entries/);
  });
});
