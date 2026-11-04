import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTeamworkSession } from "../../src/commands/teamwork/create.js";
import {
  computeTeamworkPlanHash,
  type TeammateReport,
} from "../../src/commands/teamwork/artifact.js";
import {
  runTeamworkCoordinator,
  type TeammateDispatchContext,
} from "../../src/commands/teamwork/coordinator.js";
import { readCoordinationState } from "@pennixrv/trellis-core/teamwork";
import {
  installTeammateAssets,
  frozenExecution,
} from "../helpers/teammate-assets.js";

const sourceDigest = "a".repeat(64);

interface TestEnv {
  tmpDir: string;
  projectDir: string;
  taskRoot: string;
  oldRoot: string | undefined;
  oldProject: string | undefined;
  originalCwd: typeof process.cwd;
}

function setup(): TestEnv {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "trellis-coordinator-test-"),
  );
  const projectDir = path.join(tmpDir, "project");
  const taskRoot = path.join(projectDir, ".trellis", "tasks", "task-1");
  fs.mkdirSync(path.join(projectDir, ".trellis", "agents"), {
    recursive: true,
  });
  fs.mkdirSync(taskRoot, { recursive: true });
  const goalExplorationAndRequirements = "goal_exploration_and_requirements";
  const decisionSpaceConstructionAndMerging =
    "decision_space_construction_and_merging";
  const solutionDesignAndConvergence = "solution_design_and_convergence";
  const taskImplementation = "task_implementation";
  const deliveryReviewAndCloseout = "delivery_review_and_closeout";
  const artifactRevision = "e".repeat(64);
  const notStartedPhase = {
    status: "not_started",
    input_revision: "1",
    artifact_revision: artifactRevision,
    result_revision: "0",
    artifact_refs: [],
    result_ref: null,
    outcome_kind: null,
    reason: null,
    evidence_refs: [],
    acceptance: null,
  };
  fs.writeFileSync(
    path.join(taskRoot, "task.json"),
    JSON.stringify({
      id: "task-1",
      status: "in_progress",
      meta: {
        task_workflow: {
          schema_version: 1,
          task_route_revision: "1",
          task_kind: "combined",
          complexity: "standard",
          project_context: "existing",
          phase_ids: [
            goalExplorationAndRequirements,
            decisionSpaceConstructionAndMerging,
            solutionDesignAndConvergence,
            taskImplementation,
            deliveryReviewAndCloseout,
          ],
          current_phase_id: decisionSpaceConstructionAndMerging,
          input_revision: "1",
          phases: {
            [goalExplorationAndRequirements]: {
              status: "accepted",
              input_revision: "1",
              artifact_revision: artifactRevision,
              result_revision: "1",
              artifact_refs: [],
              result_ref: "requirements.md",
              outcome_kind: "accepted",
              reason: null,
              evidence_refs: ["requirements.md"],
              acceptance: {
                artifact_revision: artifactRevision,
                result_revision: "1",
                input_revision: "1",
                task_route_revision: "1",
                evidence_refs: ["requirements.md"],
              },
            },
            [decisionSpaceConstructionAndMerging]: {
              ...notStartedPhase,
              status: "active",
            },
            [solutionDesignAndConvergence]: notStartedPhase,
            [taskImplementation]: notStartedPhase,
            [deliveryReviewAndCloseout]: notStartedPhase,
          },
          implementation_authorization: null,
          closeout_disposition: null,
          skip_records: {},
          return_record: null,
        },
      },
    }),
  );
  fs.writeFileSync(
    path.join(projectDir, ".trellis", "agents", "teammate.md"),
    "---\nname: teammate\n---\nReview assigned evidence only.\n",
  );
  const oldRoot = process.env.TRELLIS_TEAMWORK_ROOT;
  const oldProject = process.env.TRELLIS_TEAMWORK_PROJECT;
  process.env.TRELLIS_TEAMWORK_ROOT = path.join(tmpDir, "teamwork");
  delete process.env.TRELLIS_TEAMWORK_PROJECT;
  const originalCwd = process.cwd;
  vi.spyOn(process, "cwd").mockReturnValue(projectDir);
  return { tmpDir, projectDir, taskRoot, oldRoot, oldProject, originalCwd };
}

function teardown(env: TestEnv): void {
  vi.restoreAllMocks();
  if (env.oldRoot === undefined) delete process.env.TRELLIS_TEAMWORK_ROOT;
  else process.env.TRELLIS_TEAMWORK_ROOT = env.oldRoot;
  if (env.oldProject === undefined) delete process.env.TRELLIS_TEAMWORK_PROJECT;
  else process.env.TRELLIS_TEAMWORK_PROJECT = env.oldProject;
  fs.rmSync(env.tmpDir, { recursive: true, force: true });
}

function createPlan(taskRoot: string, assignmentIds: string[], maxRetries = 0) {
  const cwd = path.resolve(taskRoot, "../../..");
  installTeammateAssets(cwd);
  const execution = frozenExecution(cwd);
  const batchId = "batch-1";
  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const work = assignmentIds.map((assignmentId) => {
    const briefPath = path.join(
      "teammates",
      batchId,
      assignmentId,
      "brief.json",
    );
    const briefFile = path.join(taskRoot, briefPath);
    fs.mkdirSync(path.dirname(briefFile), { recursive: true });
    const brief = {
      schema_version: 2,
      input: "Inspect the assigned source and return cited findings.",
      task_id: "task-1",
      batch_id: batchId,
      assignment_id: assignmentId,
      execution,
      profile: "review",
      model: execution.profile.model,
      selection_reason: "Independent configured review",
      provider: "codex",
      summary: `Review the ${assignmentId} source area and return evidence-backed findings.`,
      scope: `Inspect ${assignmentId}`,
      lens: "Find correctness risks and cite evidence",
      deadline,
      source_digest: sourceDigest,
      acceptance: ["Provide cited findings"],
    };
    fs.writeFileSync(briefFile, JSON.stringify(brief));
    return {
      assignment_id: assignmentId,
      brief_path: briefPath,
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
      acceptance: ["Provide cited findings"],
      max_retries: maxRetries,
    };
  });
  const plan: Record<string, unknown> = {
    schema_version: 2,
    coordination_digest: "c".repeat(64),
    task_id: "task-1",
    batch_id: batchId,
    session_id: "parallel",
    phase_id: "decision_space_construction_and_merging",
    task_route_revision: "1",
    input_revision: "1",
    plan_summary: "Run the frozen Teamwork assignments.",
    coordination_mode: "general",
    requested_capacity: assignmentIds.length > 1 ? 2 : 1,
    deadline,
    assignments: work,
    protected_targets: [],
  };
  plan.plan_hash = computeTeamworkPlanHash(plan);
  return plan;
}

function writeReport(
  taskRoot: string,
  context: TeammateDispatchContext,
  evidence = [
    { id: "e1", locator: "src/example.ts:1", summary: "Verified behavior." },
  ],
): void {
  const reportPath = path.join(
    taskRoot,
    "teammates",
    context.plan.batchId,
    context.assignment.assignmentId,
    "attempts",
    context.attemptId,
    "report.json",
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const report: TeammateReport = {
    schemaVersion: 1,
    taskId: context.plan.taskId,
    batchId: context.plan.batchId,
    assignmentId: context.assignment.assignmentId,
    attemptId: context.attemptId,
    teammateId: context.teammateId,
    planHash: context.plan.planHash,
    phaseId: context.plan.phaseId,
    taskRouteRevision: context.plan.taskRouteRevision,
    inputRevision: context.plan.inputRevision,
    status: "complete",
    sourceDigest,
    evidence,
  };
  fs.writeFileSync(
    reportPath,
    JSON.stringify({
      schema_version: report.schemaVersion,
      task_id: report.taskId,
      batch_id: report.batchId,
      assignment_id: report.assignmentId,
      attempt_id: report.attemptId,
      teammate_id: report.teammateId,
      plan_hash: report.planHash,
      phase_id: report.phaseId,
      task_route_revision: report.taskRouteRevision,
      input_revision: report.inputRevision,
      status: report.status,
      source_digest: report.sourceDigest,
      evidence: report.evidence,
    }),
  );
}

function createRelatedPlan(
  taskRoot: string,
  relation: "committee",
  maxRetries = 1,
) {
  const plan = createPlan(taskRoot, ["work-primary"], maxRetries);
  const work = plan.assignments as Record<string, unknown>[];
  const primary = work[0];
  if (!primary) throw new Error("fixture is missing primary work");
  const primaryBriefPath = path.join(taskRoot, String(primary.brief_path));
  const primaryBrief = JSON.parse(
    fs.readFileSync(primaryBriefPath, "utf8"),
  ) as Record<string, unknown>;
  const group = { id: "review-pair", kind: "committee" };
  const secondBrief: Record<string, unknown> = {
    ...primaryBrief,
    assignment_id: "work-counter",
    provider: "codex",
    lens: "Review the contract from an independent lens",
  };
  const secondBriefPath = path.join(
    taskRoot,
    "teammates",
    "batch-1",
    "work-counter",
    "brief.json",
  );
  fs.mkdirSync(path.dirname(secondBriefPath), { recursive: true });
  fs.writeFileSync(secondBriefPath, JSON.stringify(secondBrief));
  const secondWork: Record<string, unknown> = {
    ...primary,
    assignment_id: "work-counter",
    brief_path: "teammates/batch-1/work-counter/brief.json",
    provider: "codex",
    lens: secondBrief.lens,
    brief_digest: computeTeamworkPlanHash(secondBrief),
    evaluation_group: group,
  };
  primary.evaluation_group = group;
  fs.writeFileSync(primaryBriefPath, JSON.stringify(primaryBrief));
  primary.brief_digest = computeTeamworkPlanHash(primaryBrief);
  secondWork.brief_digest = computeTeamworkPlanHash(secondBrief);
  work.push(secondWork);
  plan.coordination_mode = "committee";
  plan.requested_capacity = 2;
  plan.plan_hash = computeTeamworkPlanHash(plan);
  return plan;
}

const host = {
  foregroundWait: true,
  protectedArtifactWrites: true,
  attemptArtifactWrites: true,
  providerTransports: ["codex-app-server" as const],
  providerOptions: { codex: [] },
  verifiedHostCap: 2,
};

const guard = {
  acquire: vi.fn(async () => undefined),
  release: vi.fn(async () => undefined),
};

const config = {
  teammate: { maxConcurrency: 2 },
  guard: { maxLiveTeammates: 2, nonBatchReserved: 0 },
};

describe("TeamworkSession teammate coordinator", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = setup();
    await createTeamworkSession("parallel", { by: "main" });
  });

  afterEach(() => teardown(env));

  it("rejects missing host proof before guard acquisition or runtime dispatch", async () => {
    const plan = createPlan(env.taskRoot, ["work-a"]);
    const batchGuard = {
      acquire: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const dispatch = vi.fn(async () => undefined);

    await expect(
      runTeamworkCoordinator({
        plan,
        taskRoot: env.taskRoot,
        cwd: env.projectDir,
        host: { ...host, attemptArtifactWrites: false },
        guard: batchGuard,
        config,
        runtime: {
          dispatch,
          async wait() {
            return { kind: "reconciliation", reason: "unexpected wait" };
          },
          async continue() {
            return {
              kind: "reconciliation",
              reason: "unexpected continuation",
            };
          },
        },
      }),
    ).rejects.toThrow(/capability proof is incomplete/);

    expect(batchGuard.acquire).not.toHaveBeenCalled();
    expect(batchGuard.release).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(
      fs.existsSync(
        path.join(env.taskRoot, "teammates", "batch-1", "work-a", "queue.json"),
      ),
    ).toBe(false);
  });

  it("dispatches FIFO work into rolling slots and returns one terminal receipt", async () => {
    const plan = createPlan(env.taskRoot, ["work-a", "work-b", "work-c"]);
    const dispatched: TeammateDispatchContext[] = [];
    const waiters = new Map<
      string,
      (result: {
        kind: "report";
        terminal: true;
        providerSessionId?: string;
      }) => void
    >();
    let resolveTwoStarted!: () => void;
    let resolveTwoWaiting!: () => void;
    let resolveThreeStarted!: () => void;
    let resolveThreeWaiting!: () => void;
    const twoStarted = new Promise<void>(
      (resolve) => (resolveTwoStarted = resolve),
    );
    const twoWaiting = new Promise<void>(
      (resolve) => (resolveTwoWaiting = resolve),
    );
    const threeStarted = new Promise<void>(
      (resolve) => (resolveThreeStarted = resolve),
    );
    const threeWaiting = new Promise<void>(
      (resolve) => (resolveThreeWaiting = resolve),
    );

    const run = runTeamworkCoordinator({
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        async dispatch(context) {
          dispatched.push(context);
          if (context.assignment.assignmentId === "work-a")
            return { providerSessionId: "session-a" };
          if (dispatched.length === 2) resolveTwoStarted();
          if (dispatched.length === 3) resolveThreeStarted();
        },
        wait(context) {
          return new Promise((resolve) => {
            waiters.set(context.assignment.assignmentId, resolve);
            if (waiters.size === 2) resolveTwoWaiting();
            if (context.assignment.assignmentId === "work-c")
              resolveThreeWaiting();
          });
        },
        async continue() {
          throw new Error("no continuation expected");
        },
      },
    });

    await twoStarted;
    await twoWaiting;
    expect(dispatched.map((item) => item.assignment.assignmentId)).toEqual([
      "work-a",
      "work-b",
    ]);
    const workB = dispatched[1];
    writeReport(env.taskRoot, workB);
    waiters.get("work-b")?.({
      kind: "report",
      terminal: true,
      providerSessionId: "session-b",
    });

    await threeStarted;
    await threeWaiting;
    expect(dispatched.map((item) => item.assignment.assignmentId)).toEqual([
      "work-a",
      "work-b",
      "work-c",
    ]);
    for (const assignmentId of ["work-c", "work-a"]) {
      const context = dispatched.find(
        (item) => item.assignment.assignmentId === assignmentId,
      );
      expect(context).toBeDefined();
      if (!context) throw new Error(`missing dispatch for ${assignmentId}`);
      writeReport(env.taskRoot, context);
      waiters.get(assignmentId)?.({
        kind: "report",
        terminal: true,
        providerSessionId:
          assignmentId === "work-a" ? "session-a" : `session-${assignmentId}`,
      });
    }

    const receipt = await run;
    expect(receipt.status).toBe("ALL_ACCEPTED");
    expect(receipt.assignments.map((item) => item.status)).toEqual([
      "ACCEPTED",
      "ACCEPTED",
      "ACCEPTED",
    ]);
    expect(receipt.capacity).toBe(2);
    const state = await readCoordinationState({
      sessionId: "parallel",
      cwd: env.projectDir,
    });
    expect(state.batches[0].state).toBe("ALL_ACCEPTED");
    expect(state.assignments.map((item) => item.state)).toEqual([
      "ACCEPTED",
      "ACCEPTED",
      "ACCEPTED",
    ]);
    expect(state.leases).toEqual([]);
    const acceptedAttempt = dispatched.find(
      (item) => item.assignment.assignmentId === "work-a",
    );
    if (!acceptedAttempt) throw new Error("work-a was not dispatched");
    const attemptDir = path.join(
      env.taskRoot,
      "teammates",
      "batch-1",
      "work-a",
      "attempts",
      acceptedAttempt.attemptId,
    );
    expect(fs.existsSync(path.join(attemptDir, "report.json"))).toBe(true);
    expect(fs.existsSync(path.join(attemptDir, "claim.json"))).toBe(false);
    expect(
      fs.existsSync(
        path.join(env.taskRoot, "teammates", "batch-1", "work-a", "queue.json"),
      ),
    ).toBe(false);
  });

  it("rejects a report when the task route changes during teammate work", async () => {
    const plan = createPlan(env.taskRoot, ["work-a"]);
    const receipt = await runTeamworkCoordinator({
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        async dispatch() {
          return undefined;
        },
        async wait(context) {
          const taskFile = path.join(env.taskRoot, "task.json");
          const task = JSON.parse(fs.readFileSync(taskFile, "utf8"));
          task.meta.task_workflow.task_route_revision = "2";
          fs.writeFileSync(taskFile, JSON.stringify(task));
          writeReport(env.taskRoot, context);
          return { kind: "report", terminal: true };
        },
        async continue() {
          throw new Error("no continuation expected");
        },
      },
    });

    expect(receipt.status).toBe("SETTLED_WITH_FAILURE");
    expect(receipt.assignments[0]?.status).toBe("FINAL_FAILED");
    expect(
      fs.existsSync(
        path.join(
          env.taskRoot,
          "teammates",
          "batch-1",
          "work-a",
          "attempts",
          "work-a.attempt.0",
          "report.json",
        ),
      ),
    ).toBe(false);
  });

  it("retries a failed attempt once in the same logical slot with a new identity", async () => {
    const plan = createPlan(env.taskRoot, ["work-a"], 1);
    const dispatched: TeammateDispatchContext[] = [];
    const receipt = await runTeamworkCoordinator({
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        async dispatch(context) {
          dispatched.push(context);
          if (context.retryCount === 1) writeReport(env.taskRoot, context);
        },
        async wait(context) {
          return context.retryCount === 0
            ? {
                kind: "failed",
                terminal: true,
                reason: "provider exited before report",
              }
            : { kind: "report", terminal: true };
        },
        async continue() {
          throw new Error("no continuation expected");
        },
      },
    });

    expect(receipt.status).toBe("ALL_ACCEPTED");
    expect(receipt.retryCounts["work-a"]).toBe(1);
    expect(dispatched.map((item) => item.attemptId)).toEqual([
      "work-a.attempt.0",
      "work-a.attempt.1",
    ]);
    expect(dispatched[0].slot).toBe(dispatched[1].slot);
  });

  it("retries a report rejected by the acceptance contract within the work budget", async () => {
    const plan = createPlan(env.taskRoot, ["work-a"], 1);
    const dispatched: TeammateDispatchContext[] = [];
    const receipt = await runTeamworkCoordinator({
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        async dispatch(context) {
          dispatched.push(context);
          writeReport(env.taskRoot, context);
        },
        async wait() {
          return { kind: "report", terminal: true };
        },
        async continue() {
          throw new Error("no continuation expected");
        },
        validateReport(context) {
          return context.retryCount === 1;
        },
      },
    });

    expect(receipt.status).toBe("ALL_ACCEPTED");
    expect(receipt.retryCounts["work-a"]).toBe(1);
    expect(dispatched.map((item) => item.attemptId)).toEqual([
      "work-a.attempt.0",
      "work-a.attempt.1",
    ]);
    expect(dispatched[0].slot).toBe(dispatched[1].slot);
  });

  it("derives committee completion in the terminal batch receipt", async () => {
    const plan = createRelatedPlan(env.taskRoot, "committee", 0);
    const receipt = await runTeamworkCoordinator({
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        async dispatch(context) {
          writeReport(env.taskRoot, context, [
            {
              id: context.assignment.assignmentId,
              locator: `${context.assignment.assignmentId}.ts:1`,
              summary: "Independent evidence.",
            },
          ]);
        },
        async wait() {
          return { kind: "report", terminal: true };
        },
        async continue() {
          throw new Error("no continuation expected");
        },
      },
    });
    expect(receipt.evaluationGroups).toEqual([
      { id: "review-pair", status: "COMPLETE" },
    ]);
  });

  it("continues a timed-out attempt in place without consuming a retry", async () => {
    const plan = createPlan(env.taskRoot, ["work-a"], 1);
    const dispatched: TeammateDispatchContext[] = [];
    let waits = 0;
    const receipt = await runTeamworkCoordinator({
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        async dispatch(context) {
          dispatched.push(context);
        },
        async wait() {
          waits += 1;
          return { kind: "timeout", reason: "host wait elapsed" };
        },
        async continue(context) {
          writeReport(env.taskRoot, context);
          return {
            kind: "report",
            terminal: true,
            providerSessionId: "session-a",
          };
        },
      },
    });

    expect(receipt.status).toBe("ALL_ACCEPTED");
    expect(receipt.retryCounts["work-a"]).toBe(0);
    expect(waits).toBe(1);
    expect(dispatched).toHaveLength(1);
    const state = await readCoordinationState({
      sessionId: "parallel",
      cwd: env.projectDir,
    });
    expect(state.assignments[0]).toMatchObject({
      state: "ACCEPTED",
      retryCount: 0,
    });
    expect(state.attempts[0]).toMatchObject({
      state: "REPORT_SUBMITTED",
      providerSessionId: "session-a",
      terminal: true,
    });
  });

  it("reconciles after exhausting timeout continuations without releasing the active lease", async () => {
    const plan = createPlan(env.taskRoot, ["work-a"], 1);
    const dispatch = vi.fn(async () => undefined);
    const continueAttempt = vi.fn(async () => ({ kind: "timeout" as const }));
    const leaseGuard = {
      acquire: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };

    const receipt = await runTeamworkCoordinator({
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard: leaseGuard,
      config,
      runtime: {
        dispatch,
        async wait() {
          return { kind: "timeout", reason: "host wait elapsed" };
        },
        continue: continueAttempt,
      },
    });

    expect(receipt.status).toBe("RECONCILIATION_REQUIRED");
    expect(receipt.assignments[0].status).toBe("UNKNOWN");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(continueAttempt).toHaveBeenCalledTimes(8);
    expect(leaseGuard.release).not.toHaveBeenCalled();
    const state = await readCoordinationState({
      sessionId: "parallel",
      cwd: env.projectDir,
    });
    expect(state.attempts[0].terminal).not.toBe(true);
    expect(state.assignments[0].state).toBe("EXECUTING");
    expect(state.leases).toHaveLength(1);
  });

  it("settles failed work only after each unit exhausts its own retry budget", async () => {
    const plan = createPlan(env.taskRoot, ["work-zero", "work-bounded"], 1);
    const work = plan.assignments as Record<string, unknown>[];
    work[0].max_retries = 0;
    plan.plan_hash = computeTeamworkPlanHash(plan);
    const dispatched: TeammateDispatchContext[] = [];
    const receipt = await runTeamworkCoordinator({
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        async dispatch(context) {
          dispatched.push(context);
        },
        async wait() {
          return {
            kind: "failed",
            terminal: true,
            reason: "confirmed failure",
          };
        },
        async continue() {
          throw new Error("no continuation expected");
        },
      },
    });

    expect(receipt.status).toBe("SETTLED_WITH_FAILURE");
    expect(receipt.assignments.map((item) => item.status)).toEqual([
      "FINAL_FAILED",
      "FINAL_FAILED",
    ]);
    expect(receipt.retryCounts).toMatchObject({
      "work-zero": 0,
      "work-bounded": 1,
    });
    expect(dispatched.map((item) => item.assignment.assignmentId)).toEqual([
      "work-zero",
      "work-bounded",
      "work-bounded",
    ]);
    expect(dispatched[1].slot).toBe(dispatched[2].slot);
  });

  it("refuses to dispatch when the shared guard is contended", async () => {
    const plan = createPlan(env.taskRoot, ["work-a"]);
    const dispatch = vi.fn(async () => undefined);
    await expect(
      runTeamworkCoordinator({
        plan,
        taskRoot: env.taskRoot,
        cwd: env.projectDir,
        host,
        guard: {
          acquire: async () => {
            throw new Error("shared guard is busy");
          },
          release: vi.fn(async () => undefined),
        },
        config,
        runtime: {
          dispatch,
          async wait() {
            return { kind: "failed", terminal: true, reason: "unused" };
          },
          async continue() {
            return { kind: "failed", terminal: true, reason: "unused" };
          },
        },
      }),
    ).rejects.toThrow(/guard is busy/);
    expect(dispatch).not.toHaveBeenCalled();
    const state = await readCoordinationState({
      sessionId: "parallel",
      cwd: env.projectDir,
    });
    expect(state.batches).toEqual([]);
  });

  it("drains confirmed cancellations and reconciles queued work without dispatching it", async () => {
    const plan = createPlan(env.taskRoot, ["work-a", "work-b", "work-c"]);
    const dispatched: TeammateDispatchContext[] = [];
    const cancel = vi.fn(async () => ({
      kind: "cancelled" as const,
      terminal: true as const,
      reason: "coordinator cancellation",
    }));
    const receipt = await runTeamworkCoordinator({
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        async dispatch(context) {
          dispatched.push(context);
        },
        async wait(context) {
          if (context.assignment.assignmentId === "work-a") {
            return {
              kind: "cancelled",
              terminal: true,
              reason: "host cancelled",
            };
          }
          return new Promise(() => undefined);
        },
        cancel,
        async continue() {
          throw new Error("no continuation expected");
        },
      },
    });

    expect(receipt.status).toBe("RECONCILIATION_REQUIRED");
    expect(receipt.assignments.map((item) => item.status)).toEqual([
      "FINAL_FAILED",
      "FINAL_FAILED",
      "UNKNOWN",
    ]);
    expect(dispatched.map((item) => item.assignment.assignmentId)).toEqual([
      "work-a",
      "work-b",
    ]);
    expect(cancel).toHaveBeenCalledTimes(1);
    const state = await readCoordinationState({
      sessionId: "parallel",
      cwd: env.projectDir,
    });
    expect(state.batches[0].state).toBe("RECONCILIATION_REQUIRED");
    expect(state.leases).toEqual([]);
  });

  it("does not read a report before the host confirms terminal completion", async () => {
    const plan = createPlan(env.taskRoot, ["work-a"]);
    const reportPath = path.join(
      env.taskRoot,
      "teammates",
      "batch-1",
      "work-a",
      "attempts",
      "work-a.attempt.0",
      "report.json",
    );
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, "not valid report json");
    const receipt = await runTeamworkCoordinator({
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        async dispatch() {
          return;
        },
        async wait() {
          return { kind: "report", terminal: false } as never;
        },
        async continue() {
          throw new Error("no continuation expected");
        },
      },
    });

    expect(receipt.status).toBe("RECONCILIATION_REQUIRED");
    expect(receipt.assignments[0].status).toBe("UNKNOWN");
    const state = await readCoordinationState({
      sessionId: "parallel",
      cwd: env.projectDir,
    });
    expect(state.attempts[0].terminal).not.toBe(true);
  });

  it("records reconciliation after an uncertain dispatch and never redispatches on recovery", async () => {
    const plan = createPlan(env.taskRoot, ["work-a"]);
    const dispatch = vi.fn(async () => {
      throw new Error("provider launch failed after command issue");
    });
    const receipt = await runTeamworkCoordinator({
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        dispatch,
        async wait() {
          return { kind: "report", terminal: true };
        },
        async continue() {
          return { kind: "report", terminal: true };
        },
      },
    });

    expect(receipt.status).toBe("RECONCILIATION_REQUIRED");
    expect(receipt.assignments[0].status).toBe("UNKNOWN");
    const state = await readCoordinationState({
      sessionId: "parallel",
      cwd: env.projectDir,
    });
    expect(state.batches[0].state).toBe("RECONCILIATION_REQUIRED");
    expect(state.receipts).toEqual(["batch-1:RECONCILIATION_REQUIRED"]);
    expect(state.leases).toHaveLength(1);

    const recovered = await runTeamworkCoordinator({
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        dispatch,
        async wait() {
          throw new Error("recovery must not wait");
        },
        async continue() {
          throw new Error("recovery must not continue");
        },
      },
    });
    expect(recovered.status).toBe("RECONCILIATION_REQUIRED");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("rejects a plan hash mismatch before writing coordinator state", async () => {
    const plan = createPlan(env.taskRoot, ["work-a"]);
    (plan as { plan_hash: string }).plan_hash = "0".repeat(64);
    await expect(
      runTeamworkCoordinator({
        plan,
        taskRoot: env.taskRoot,
        cwd: env.projectDir,
        host,
        guard,
        config,
        runtime: {
          async dispatch() {
            return;
          },
          async wait() {
            return { kind: "failed", terminal: true, reason: "unused" };
          },
          async continue() {
            return { kind: "failed", terminal: true, reason: "unused" };
          },
        },
      }),
    ).rejects.toThrow(/plan hash/);
    const state = await readCoordinationState({
      sessionId: "parallel",
      cwd: env.projectDir,
    });
    expect(state.batches).toEqual([]);
  });
});
