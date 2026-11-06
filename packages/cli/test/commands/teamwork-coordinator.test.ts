import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTeamworkSession } from "../../src/commands/teamwork/create.js";
import {
  computeTeamworkPlanHash,
  validateTeamworkPlan,
  type TeammateReport,
} from "../../src/commands/teamwork/artifact.js";
import {
  buildBatchResult,
  teamworkBatch,
  cleanupTeamworkAttemptEvidence,
} from "../../src/commands/teamwork/batch.js";
import { writeBatchReservation } from "../../src/commands/teamwork/batch-reservation.js";
import { projectDir } from "../../src/commands/teamwork/store/paths.js";
import {
  runTeamworkCoordinator,
  reconcileTeamworkBatch,
  reviewTeamworkReport,
  type TeammateDispatchContext,
} from "../../src/commands/teamwork/coordinator.js";
import { constructTeamworkRetry } from "../../src/commands/teamwork/plan.js";
import { readCoordinationConfig } from "../../src/commands/teamwork/coordination.js";
import {
  readCoordinationState,
  recordCoordinationEvent,
  readTeamworkEvents,
  resolveTeamworkSession,
} from "@pennixrv/trellis-core/teamwork";
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

function createPlan(
  taskRoot: string,
  assignmentIds: string[],
  maxRetries = 0,
  legacy = false,
) {
  const cwd = path.resolve(taskRoot, "../../..");
  installTeammateAssets(cwd);
  const execution = frozenExecution(cwd);
  if (legacy) {
    delete execution.launch.reportVersion;
    execution.launch.instructions = execution.profile.rolePrompt;
    execution.launch.prompt = execution.profile.rolePrompt;
  }
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
  status: TeammateReport["status"] = "complete",
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
    schemaVersion: context.launch.reportVersion ?? 1,
    taskId: context.plan.taskId,
    batchId: context.plan.batchId,
    assignmentId: context.assignment.assignmentId,
    attemptId: context.attemptId,
    teammateId: context.teammateId,
    planHash: context.plan.planHash,
    phaseId: context.plan.phaseId,
    taskRouteRevision: context.plan.taskRouteRevision,
    inputRevision: context.plan.inputRevision,
    status,
    sourceDigest,
    evidence,
  };
  fs.writeFileSync(
    reportPath,
    JSON.stringify({
      ...(report.schemaVersion === 2
        ? {
            answer: "Verified the assigned behavior against the cited source.",
            limitations: [],
            unresolved:
              status === "complete" ? [] : ["Assigned check is blocked."],
            deviations: [],
          }
        : {}),
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

  it("requires associated exit evidence before retiring an uncertain batch", async () => {
    const raw = createPlan(env.taskRoot, ["work-a"], 0);
    const plan = validateTeamworkPlan(raw, env.taskRoot);
    await runTeamworkCoordinator({
      plan: raw,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        dispatch: vi.fn(),
        wait: async () => ({
          kind: "reconciliation",
          reason: "lost provider handle",
        }),
        continue: vi.fn(),
      },
    });
    const request = {
      plan,
      cwd: env.projectDir,
      reason: "verified provider termination",
    };
    expect(await reconcileTeamworkBatch(request)).toMatchObject({
      status: "blocked",
    });
    await expect(
      reconcileTeamworkBatch({ ...request, execute: true }),
    ).rejects.toThrow(/preserve its lease/);
    await recordCoordinationEvent({
      sessionId: plan.sessionId,
      cwd: env.projectDir,
      by: "main",
      batchId: plan.batchId,
      entity: "attempt",
      action: "process_exited",
      attemptId: "work-a.attempt.0",
      planHash: plan.planHash,
      idempotencyKey: "fixture-exit",
    });
    expect(await reconcileTeamworkBatch(request)).toEqual({
      status: "ready",
      blockers: [],
    });
    expect(
      await reconcileTeamworkBatch({ ...request, execute: true }),
    ).toMatchObject({ status: "SETTLED_WITH_FAILURE" });
    expect(
      await reconcileTeamworkBatch({ ...request, execute: true }),
    ).toMatchObject({ status: "SETTLED_WITH_FAILURE" });
    const state = await readCoordinationState({
      sessionId: plan.sessionId,
      cwd: env.projectDir,
    });
    expect(state.leases).toHaveLength(0);
    expect(state.issues).toEqual([]);
  });

  it("requires explicit audited confirmation to retire an attempt with unknown process identity", async () => {
    const raw = createPlan(env.taskRoot, ["work-a"], 0);
    const plan = validateTeamworkPlan(raw, env.taskRoot);
    await runTeamworkCoordinator({
      plan: raw,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        dispatch: vi.fn(),
        wait: async () => ({
          kind: "reconciliation",
          reason: "lost provider handle",
        }),
        continue: vi.fn(),
      },
    });
    const request = {
      plan,
      cwd: env.projectDir,
      reason: "Operator confirmed the provider process is no longer active",
    };
    expect(await reconcileTeamworkBatch(request)).toMatchObject({
      status: "blocked",
    });
    await expect(
      reconcileTeamworkBatch({ ...request, execute: true }),
    ).rejects.toThrow(/preserve its lease/);
    await expect(
      reconcileTeamworkBatch({
        ...request,
        execute: true,
        confirmUnknownProcessExit: true,
      }),
    ).resolves.toMatchObject({ status: "SETTLED_WITH_FAILURE" });
    const events = await readTeamworkEvents({
      sessionId: plan.sessionId,
      cwd: env.projectDir,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "coordination",
        action: "reconciliation_resolved",
        reason: request.reason,
        payload: { confirmedUnknownProcessExit: true },
      }),
    );
  });

  it("preserves a changed reconciliation disposition reason after an interrupted resolution", async () => {
    const raw = createPlan(env.taskRoot, ["work-a"], 0);
    const plan = validateTeamworkPlan(raw, env.taskRoot);
    await runTeamworkCoordinator({
      plan: raw,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        dispatch: vi.fn(),
        wait: async () => ({
          kind: "reconciliation",
          reason: "lost provider handle",
        }),
        continue: vi.fn(),
      },
    });
    await recordCoordinationEvent({
      sessionId: plan.sessionId,
      cwd: env.projectDir,
      by: "main",
      batchId: plan.batchId,
      entity: "attempt",
      action: "process_exited",
      attemptId: "work-a.attempt.0",
      planHash: plan.planHash,
      idempotencyKey: "fixture-exit",
    });
    await recordCoordinationEvent({
      sessionId: plan.sessionId,
      cwd: env.projectDir,
      by: "main",
      batchId: plan.batchId,
      entity: "batch",
      action: "reconciliation_resolved",
      reason: "first resolution before crash",
      idempotencyKey: `${plan.batchId}:reconciled`,
    });
    await reconcileTeamworkBatch({
      plan,
      cwd: env.projectDir,
      execute: true,
      reason: "verified termination after recovery",
    });
    const resolutions = (await readTeamworkEvents({
      sessionId: plan.sessionId,
      cwd: env.projectDir,
    })).filter(
      (event) =>
        event.kind === "coordination" &&
        event.batchId === plan.batchId &&
        event.action === "reconciliation_resolved",
    );
    expect(resolutions.map((event) => event.reason)).toEqual([
      "first resolution before crash",
      "verified termination after recovery",
    ]);
  });

  it("publishes an idempotent linked retry round containing only failed work", async () => {
    const raw = createPlan(env.taskRoot, ["work-a", "work-b"], 0);
    raw.coordination_digest = readCoordinationConfig(
      env.projectDir,
    ).configDigest;
    raw.plan_hash = computeTeamworkPlanHash(raw);
    const file = path.join(env.taskRoot, "original-plan.json");
    fs.writeFileSync(file, JSON.stringify(raw));
    await runTeamworkCoordinator({
      plan: raw,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        async dispatch(context) {
          if (context.assignment.assignmentId === "work-a")
            writeReport(env.taskRoot, context);
        },
        async wait(context) {
          return context.assignment.assignmentId === "work-a"
            ? { kind: "report", terminal: true }
            : { kind: "failed", terminal: true, reason: "failed work" };
        },
        continue: vi.fn(),
      },
    });
    const reviewedFile = path.join(env.taskRoot, "teammates/batch-1/work-a/attempts/work-a.attempt.0/report.json");
    await reviewTeamworkReport({ plan: validateTeamworkPlan(raw, env.taskRoot), taskRoot: env.taskRoot,
      cwd: env.projectDir, assignmentId: "work-a", decision: "accepted", reason: "Evidence accepted by main agent",
      reportSha256: crypto.createHash("sha256").update(fs.readFileSync(reviewedFile)).digest("hex") });
    const request = {
      planPath: file,
      cwd: env.projectDir,
      taskRoot: env.taskRoot,
      output: path.join(env.taskRoot, "retry.json"),
      batch: "retry-1",
      assignments: "work-b",
      deadline: new Date(Date.now() + 60000).toISOString(),
      approvalRef: "user-retry-1",
    };
    const retry = await constructTeamworkRetry(request);
    expect(
      (retry.assignments as Record<string, unknown>[]).map(
        (entry) => entry.assignment_id,
      ),
    ).toEqual(["work-b"]);
    expect(retry.retry_of).toMatchObject({
      batch_id: "batch-1",
      approval_ref: "user-retry-1",
    });
    expect(await constructTeamworkRetry(request)).toEqual(retry);
    await expect(
      constructTeamworkRetry({ ...request, assignments: "work-a" }),
    ).rejects.toThrow(/not a settled failure/);
    const original = validateTeamworkPlan(raw, env.taskRoot);
    const preview = await cleanupTeamworkAttemptEvidence(
      original,
      env.taskRoot,
      env.projectDir,
    );
    expect(preview.files).toHaveLength(1);
    const artifactPath = preview.files[0];
    if (!artifactPath) throw new Error("Expected retained report artifact");
    await expect(
      cleanupTeamworkAttemptEvidence(
        original,
        env.taskRoot,
        env.projectDir,
        "wrong-preview",
      ),
    ).rejects.toThrow(/preview changed/);
    expect(fs.existsSync(path.join(env.taskRoot, artifactPath))).toBe(true);
    expect(
      (
        await cleanupTeamworkAttemptEvidence(
          original,
          env.taskRoot,
          env.projectDir,
          preview.digest,
        )
      ).status,
    ).toBe("removed");
    expect(fs.existsSync(path.join(env.taskRoot, artifactPath))).toBe(false);
  });

  it("counts other durable batch reservations before starting a provider", async () => {
    const raw = createPlan(env.taskRoot, ["work-a"], 0);
    raw.coordination_digest = readCoordinationConfig(
      env.projectDir,
    ).configDigest;
    raw.plan_hash = computeTeamworkPlanHash(raw);
    const file = path.join(env.taskRoot, "plan.json");
    fs.writeFileSync(file, JSON.stringify(raw));
    const ref = resolveTeamworkSession({
      sessionId: "parallel",
      cwd: env.projectDir,
    });
    writeBatchReservation(projectDir(ref.project), {
      schemaVersion: 1,
      sessionId: "another",
      batchId: "reserved",
      planHash: "f".repeat(64),
      capacity: 8,
      ownerPid: process.pid,
    });
    await expect(
      teamworkBatch(file, { task: env.taskRoot, json: true }),
    ).rejects.toThrow(/remaining live teammate budget/);
    expect(
      (
        await readCoordinationState({
          sessionId: "parallel",
          cwd: env.projectDir,
        })
      ).attempts,
    ).toHaveLength(0);
  });

  it("settles a launch preflight failure without dispatching or retaining leases", async () => {
    const dispatch = vi.fn(async () => undefined);
    const receipt = await runTeamworkCoordinator({
      plan: createPlan(env.taskRoot, ["work-a", "work-b"]),
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        prepare() {
          throw new Error("frozen context changed");
        },
        dispatch,
        wait: vi.fn(),
        continue: vi.fn(),
      },
    });
    expect(receipt.status).toBe("SETTLED_WITH_FAILURE");
    expect(dispatch).not.toHaveBeenCalled();
    const projection = await readCoordinationState({
      sessionId: "parallel",
      cwd: env.projectDir,
    });
    expect(projection.leases).toHaveLength(0);
    expect(projection.attempts).toHaveLength(0);
  });

  it("settles historical schema-1 reports without synthesizing schema-2 content", async () => {
    const plan = createPlan(env.taskRoot, ["legacy"], 0, true);
    const receipt = await runTeamworkCoordinator({
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        async dispatch(context) {
          writeReport(env.taskRoot, context);
        },
        async wait() {
          return { kind: "report", terminal: true };
        },
        async continue() {
          throw new Error("unexpected continuation");
        },
      },
    });
    expect(receipt.status).toBe("AWAITING_REVIEW");
    const result = await buildBatchResult(
      validateTeamworkPlan(plan, env.taskRoot),
      receipt,
      env.taskRoot,
      env.projectDir,
    );
    expect(result.reports[0]).toMatchObject({
      validation: "legacy",
      report: null,
    });
  });

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
    expect(receipt.status).toBe("AWAITING_REVIEW");
    const result = await buildBatchResult(
      validateTeamworkPlan(plan, env.taskRoot),
      receipt,
      env.taskRoot,
      env.projectDir,
    );
    expect(result.semanticValidation).toBe("not_run");
    expect(result.reports).toHaveLength(3);
    for (const item of result.reports) {
      expect(item.validation).toBe("passed");
      expect(item.report?.answer).toContain("Verified");
      expect(item.artifact?.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(fs.existsSync(item.artifact?.path ?? "")).toBe(true);
    }
    const damaged = result.reports[0]?.artifact?.path;
    if (!damaged) throw new Error("Missing report artifact");
    const original = fs.readFileSync(damaged, "utf8");
    fs.writeFileSync(damaged, "{}");
    const invalid = await buildBatchResult(
      validateTeamworkPlan(plan, env.taskRoot),
      receipt,
      env.taskRoot,
      env.projectDir,
    );
    expect(invalid.reports[0]?.validation).toBe("failed");
    fs.writeFileSync(damaged, original);
    expect(receipt.assignments.map((item) => item.status)).toEqual([
      "AWAITING_REVIEW",
      "AWAITING_REVIEW",
      "AWAITING_REVIEW",
    ]);
    expect(receipt.capacity).toBe(2);
    const state = await readCoordinationState({
      sessionId: "parallel",
      cwd: env.projectDir,
    });
    expect(state.batches[0].state).toBe("AWAITING_REVIEW");
    expect(state.assignments.map((item) => item.state)).toEqual([
      "AWAITING_REVIEW",
      "AWAITING_REVIEW",
      "AWAITING_REVIEW",
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
    expect(fs.existsSync(path.join(attemptDir, "claim.json"))).toBe(true);
    expect(
      fs.existsSync(
        path.join(env.taskRoot, "teammates", "batch-1", "work-a", "queue.json"),
      ),
    ).toBe(true);
  });

  it("fills a freed slot while another slot is waiting on the same attempt", async () => {
    const plan = createPlan(env.taskRoot, ["work-a", "work-b", "work-c"]);
    const dispatched: TeammateDispatchContext[] = [];
    const waiters = new Map<
      string,
      (result: { kind: "report"; terminal: true }) => void
    >();
    let resolveTwoWaiting!: () => void;
    let resolveThreeStarted!: () => void;
    let resolveThreeWaiting!: () => void;
    let resolveContinuationStarted!: () => void;
    let resolveContinuation!: (result: {
      kind: "report";
      terminal: true;
    }) => void;
    const twoWaiting = new Promise<void>((resolve) => {
      resolveTwoWaiting = resolve;
    });
    const threeStarted = new Promise<void>((resolve) => {
      resolveThreeStarted = resolve;
    });
    const threeWaiting = new Promise<void>((resolve) => {
      resolveThreeWaiting = resolve;
    });
    const continuationStarted = new Promise<void>((resolve) => {
      resolveContinuationStarted = resolve;
    });

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
          if (dispatched.length === 3) resolveThreeStarted();
        },
        wait(context) {
          if (context.assignment.assignmentId === "work-a")
            return Promise.resolve({ kind: "timeout", reason: "yield wait" });
          return new Promise((resolve) => {
            waiters.set(context.assignment.assignmentId, resolve);
            if (context.assignment.assignmentId === "work-b")
              resolveTwoWaiting();
            if (context.assignment.assignmentId === "work-c")
              resolveThreeWaiting();
          });
        },
        continue() {
          resolveContinuationStarted();
          return new Promise((resolve) => {
            resolveContinuation = resolve;
          });
        },
      },
    });

    await twoWaiting;
    await continuationStarted;
    const workB = dispatched.find(
      (item) => item.assignment.assignmentId === "work-b",
    );
    if (!workB) throw new Error("work-b was not dispatched");
    writeReport(env.taskRoot, workB);
    waiters.get("work-b")?.({ kind: "report", terminal: true });
    await threeStarted;
    await threeWaiting;
    expect(dispatched.map((item) => item.assignment.assignmentId)).toEqual([
      "work-a",
      "work-b",
      "work-c",
    ]);
    const workC = dispatched.find(
      (item) => item.assignment.assignmentId === "work-c",
    );
    const workA = dispatched.find(
      (item) => item.assignment.assignmentId === "work-a",
    );
    if (!workA || !workC)
      throw new Error("FIFO fixture did not dispatch all work");
    writeReport(env.taskRoot, workA);
    resolveContinuation({ kind: "report", terminal: true });
    writeReport(env.taskRoot, workC);
    waiters.get("work-c")?.({ kind: "report", terminal: true });

    const receipt = await run;
    expect(receipt.status).toBe("AWAITING_REVIEW");
    expect(receipt.retryCounts).toMatchObject({
      "work-a": 0,
      "work-b": 0,
      "work-c": 0,
    });
  });

  it("rejects stale work and closes FIFO admission when the task route changes", async () => {
    const plan = createPlan(env.taskRoot, ["work-a", "work-b"]);
    plan.requested_capacity = 1;
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
    expect(receipt.assignments.map((item) => item.status)).toEqual([
      "FINAL_FAILED",
      "FINAL_FAILED",
    ]);
    expect(dispatched.map((item) => item.assignment.assignmentId)).toEqual([
      "work-a",
    ]);
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
    ).toBe(true);
  });

  it("settles a blocked report and continues the remaining FIFO assignments", async () => {
    const plan = createPlan(env.taskRoot, ["work-a", "work-b"]);
    plan.requested_capacity = 1;
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
        async wait(context) {
          writeReport(
            env.taskRoot,
            context,
            undefined,
            context.assignment.assignmentId === "work-a"
              ? "blocked"
              : "complete",
          );
          return { kind: "report", terminal: true };
        },
        async continue() {
          throw new Error("no continuation expected");
        },
      },
    });

    expect(receipt.status).toBe("AWAITING_REVIEW");
    expect(receipt.assignments.map((item) => item.status)).toEqual([
      "AWAITING_REVIEW",
      "AWAITING_REVIEW",
    ]);
    expect(dispatched.map((item) => item.assignment.assignmentId)).toEqual([
      "work-a",
      "work-b",
    ]);
    expect(
      fs.existsSync(
        path.join(
          env.taskRoot,
          "teammates",
          "batch-1",
          "work-a",
          "attempts",
          dispatched[0].attemptId,
          "report.json",
        ),
      ),
    ).toBe(true);
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

    expect(receipt.status).toBe("AWAITING_REVIEW");
    expect(receipt.retryCounts["work-a"]).toBe(1);
    expect(dispatched.map((item) => item.attemptId)).toEqual([
      "work-a.attempt.0",
      "work-a.attempt.1",
    ]);
    expect(dispatched[0].slot).toBe(dispatched[1].slot);
    const result = await buildBatchResult(
      validateTeamworkPlan(plan, env.taskRoot),
      receipt,
      env.taskRoot,
      env.projectDir,
    );
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]?.association.attemptId).toBe("work-a.attempt.1");
    expect(result.attempts?.map((item) => item.association.attemptId)).toEqual([
      "work-a.attempt.0",
      "work-a.attempt.1",
    ]);
    expect(result.attempts?.[0]?.validation).toBe("failed");
    expect(result.attempts?.[1]?.validation).toBe("passed");
  });

  it("keeps generated identities within the protocol limit for maximum-length assignment ids", async () => {
    const assignmentId = "w".repeat(64);
    const plan = createPlan(env.taskRoot, [assignmentId], 1);
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
            ? { kind: "failed", terminal: true, reason: "retry fixture" }
            : { kind: "report", terminal: true };
        },
        async continue() {
          throw new Error("no continuation expected");
        },
      },
    });

    expect(receipt.status).toBe("AWAITING_REVIEW");
    expect(dispatched).toHaveLength(2);
    for (const context of dispatched) {
      expect(context.attemptId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
      expect(context.teammateId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
    }
    expect(dispatched[0].attemptId).not.toBe(dispatched[1].attemptId);
    expect(dispatched[0].teammateId).not.toBe(dispatched[1].teammateId);
  });

  it("collects a report once and requires explicit main-agent review", async () => {
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
      },
    });

    expect(receipt.status).toBe("AWAITING_REVIEW");
    expect(receipt.retryCounts["work-a"]).toBe(0);
    expect(dispatched.map((item) => item.attemptId)).toEqual([
      "work-a.attempt.0",
    ]);
    const reportFile = path.join(env.taskRoot, "teammates/batch-1/work-a/attempts/work-a.attempt.0/report.json");
    const review = { plan: validateTeamworkPlan(plan, env.taskRoot), taskRoot: env.taskRoot,
      cwd: env.projectDir, assignmentId: "work-a", decision: "accepted" as const,
      reason: "Main agent checked the evidence against all acceptance criteria",
      reportSha256: crypto.createHash("sha256").update(fs.readFileSync(reportFile)).digest("hex") };
    await expect(reviewTeamworkReport({ ...review, reportSha256: "0".repeat(64) })).rejects.toThrow(/digest/);
    expect((await reviewTeamworkReport(review)).status).toBe("ALL_ACCEPTED");
    expect((await reviewTeamworkReport(review)).status).toBe("ALL_ACCEPTED");
    const disposition = JSON.parse(fs.readFileSync(path.join(path.dirname(reportFile), "disposition.json"), "utf8"));
    expect(disposition.review).toMatchObject({ plan_hash: review.plan.planHash, report_sha256: review.reportSha256 });
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
      { id: "review-pair", status: "INCOMPLETE" },
    ]);
    const validated = validateTeamworkPlan(plan, env.taskRoot);
    for (const [index, assignment] of validated.assignments.entries()) {
      const reportFile = path.join(env.taskRoot, path.dirname(assignment.briefPath), "attempts", `${assignment.assignmentId}.attempt.0`, "report.json");
      const reviewed = await reviewTeamworkReport({ plan: validated, taskRoot: env.taskRoot,
        cwd: env.projectDir, assignmentId: assignment.assignmentId, decision: "accepted",
        reason: "All assigned criteria checked against report evidence",
        reportSha256: crypto.createHash("sha256").update(fs.readFileSync(reportFile)).digest("hex") });
      expect(reviewed.status).toBe(index === validated.assignments.length - 1 ? "ALL_ACCEPTED" : "AWAITING_REVIEW");
    }
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

    expect(receipt.status).toBe("AWAITING_REVIEW");
    expect(receipt.retryCounts["work-a"]).toBe(0);
    expect(waits).toBe(1);
    expect(dispatched).toHaveLength(1);
    const state = await readCoordinationState({
      sessionId: "parallel",
      cwd: env.projectDir,
    });
    expect(state.assignments[0]).toMatchObject({
      state: "AWAITING_REVIEW",
      retryCount: 0,
    });
    expect(state.attempts[0]).toMatchObject({
      state: "REPORT_SUBMITTED",
      providerSessionId: "session-a",
      terminal: true,
    });
  });

  it("keeps same-attempt continuations under the deadline without a fixed retry limit", async () => {
    const plan = createPlan(env.taskRoot, ["work-a"], 1);
    const dispatch = vi.fn(async () => undefined);
    let continuations = 0;
    const continueAttempt = vi.fn(async (context: TeammateDispatchContext) => {
      continuations += 1;
      if (continuations < 9) return { kind: "timeout" as const };
      writeReport(env.taskRoot, context);
      return { kind: "report" as const, terminal: true as const };
    });
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

    expect(receipt.status).toBe("AWAITING_REVIEW");
    expect(receipt.assignments[0].status).toBe("AWAITING_REVIEW");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(continueAttempt).toHaveBeenCalledTimes(9);
    expect(leaseGuard.release).toHaveBeenCalledTimes(1);
    const state = await readCoordinationState({
      sessionId: "parallel",
      cwd: env.projectDir,
    });
    expect(state.attempts[0]).toMatchObject({
      state: "REPORT_SUBMITTED",
      retryCount: 0,
      terminal: true,
    });
    expect(state.assignments[0].state).toBe("AWAITING_REVIEW");
    expect(state.leases).toEqual([]);
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
    const result = await buildBatchResult(
      validateTeamworkPlan(plan, env.taskRoot),
      receipt,
      env.taskRoot,
      env.projectDir,
    );
    expect(result.reports[1]).toMatchObject({
      association: { attemptId: "work-bounded.attempt.1" },
      error: expect.stringContaining("confirmed failure"),
    });
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

  it("drains confirmed cancellations and settles queued FIFO work as failed", async () => {
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

    expect(receipt.status).toBe("SETTLED_WITH_FAILURE");
    expect(receipt.assignments.map((item) => item.status)).toEqual([
      "FINAL_FAILED",
      "FINAL_FAILED",
      "FINAL_FAILED",
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
    expect(state.batches[0].state).toBe("SETTLED_WITH_FAILURE");
    expect(state.leases).toEqual([]);
  });

  it("cancels every active slot and retains only the unconfirmed lease", async () => {
    const plan = createPlan(env.taskRoot, ["work-a", "work-b", "work-c"]);
    const dispatched: TeammateDispatchContext[] = [];
    const cancelled: string[] = [];
    const cancel = vi.fn(async (context: TeammateDispatchContext) => {
      cancelled.push(context.assignment.assignmentId);
      return { kind: "reconciliation" as const, reason: "cannot confirm exit" };
    });
    const batchGuard = {
      acquire: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const receipt = await runTeamworkCoordinator({
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard: batchGuard,
      config,
      runtime: {
        async dispatch(context) {
          dispatched.push(context);
        },
        wait(context) {
          return context.assignment.assignmentId === "work-a"
            ? Promise.resolve({
                kind: "timeout",
                reason: "yield before cancel",
              })
            : new Promise(() => undefined);
        },
        async continue() {
          return {
            kind: "cancelled",
            terminal: true,
            reason: "process exit confirmed",
          };
        },
        cancel,
      },
    });

    expect(receipt.status).toBe("RECONCILIATION_REQUIRED");
    expect(dispatched.map((item) => item.assignment.assignmentId)).toEqual([
      "work-a",
      "work-b",
    ]);
    expect(cancelled).toEqual(["work-b"]);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(batchGuard.release).not.toHaveBeenCalled();
    const state = await readCoordinationState({
      sessionId: "parallel",
      cwd: env.projectDir,
    });
    expect(state.leases).toHaveLength(1);
    expect(state.leases[0]?.leaseId).toContain(dispatched[1]?.attemptId);
    expect(
      state.assignments.find((item) => item.assignmentId === "work-a")?.state,
    ).toBe("FINAL_FAILED");
    expect(
      state.assignments.find((item) => item.assignmentId === "work-b")?.state,
    ).toBe("EXECUTING");
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

  it.each(["directory", "malformed"] as const)(
    "settles a terminal attempt with a %s report artifact as member failure",
    async (artifactKind) => {
      const plan = createPlan(env.taskRoot, ["work-a"], 1);
      const batchGuard = {
        acquire: vi.fn(async () => undefined),
        release: vi.fn(async () => undefined),
      };
      const reportPath = path.join(
        env.taskRoot,
        "teammates",
        "batch-1",
        "work-a",
        "attempts",
        "work-a.attempt.0",
        "report.json",
      );
      const receipt = await runTeamworkCoordinator({
        plan,
        taskRoot: env.taskRoot,
        cwd: env.projectDir,
        host,
        guard: batchGuard,
        config,
        runtime: {
          async dispatch() {
            fs.mkdirSync(path.dirname(reportPath), { recursive: true });
            if (artifactKind === "directory") fs.mkdirSync(reportPath);
            else fs.writeFileSync(reportPath, '{"schema_version":');
          },
          async wait() {
            return { kind: "report", terminal: true };
          },
          async continue() {
            throw new Error("no continuation expected");
          },
        },
      });

      expect(receipt.status).toBe("SETTLED_WITH_FAILURE");
      expect(receipt.assignments[0]?.status).toBe("FINAL_FAILED");
      expect(batchGuard.release).toHaveBeenCalledOnce();
      const state = await readCoordinationState({
        sessionId: "parallel",
        cwd: env.projectDir,
      });
      expect(state.leases).toHaveLength(0);
    },
  );

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

  it("refuses terminal recovery while a conflicting capacity lease remains", async () => {
    const plan = createPlan(env.taskRoot, ["work-a"]);
    const batchGuard = {
      acquire: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const dispatch = vi.fn(async (context: TeammateDispatchContext) => {
      writeReport(env.taskRoot, context);
    });
    const input = {
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard: batchGuard,
      config,
      runtime: {
        dispatch,
        async wait() {
          return { kind: "report" as const, terminal: true as const };
        },
        async continue() {
          throw new Error("recovered terminal work must not continue");
        },
      },
    };
    expect((await runTeamworkCoordinator(input)).status).toBe("AWAITING_REVIEW");
    await recordCoordinationEvent({
      sessionId: "parallel",
      cwd: env.projectDir,
      by: "main",
      batchId: plan.batch_id as string,
      entity: "attempt",
      action: "lease_acquired",
      leaseId: "conflicting-live-lease",
      protected: true,
    });

    const recovered = await runTeamworkCoordinator(input);

    expect(recovered.status).toBe("RECONCILIATION_REQUIRED");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(batchGuard.acquire).toHaveBeenCalledTimes(2);
    expect(batchGuard.release).toHaveBeenCalledTimes(1);
    const state = await readCoordinationState({
      sessionId: "parallel",
      cwd: env.projectDir,
    });
    expect(state.batches[0]?.state).toBe("AWAITING_REVIEW");
    expect(state.leases).toContainEqual(
      expect.objectContaining({ leaseId: "conflicting-live-lease" }),
    );
  });

  it("rejects a conflicting saved receipt instead of returning terminal success", async () => {
    const plan = createPlan(env.taskRoot, ["work-a"]);
    const batchGuard = {
      acquire: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const dispatch = vi.fn(async (context: TeammateDispatchContext) => {
      writeReport(env.taskRoot, context);
    });
    const input = {
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard: batchGuard,
      config,
      runtime: {
        dispatch,
        async wait() {
          return { kind: "report" as const, terminal: true as const };
        },
        async continue() {
          throw new Error("recovered terminal work must not continue");
        },
      },
    };
    expect((await runTeamworkCoordinator(input)).status).toBe("AWAITING_REVIEW");
    await recordCoordinationEvent({
      sessionId: "parallel",
      cwd: env.projectDir,
      by: "main",
      batchId: String(plan.batch_id),
      entity: "batch",
      action: "receipt_recorded",
      idempotencyKey: "conflicting-terminal-receipt",
      payload: {
        schemaVersion: 1,
        batchId: plan.batch_id,
        status: "AWAITING_REVIEW",
        assignments: [],
        capacity: 1,
        retryCounts: {},
        evaluationGroups: [],
      },
    });

    const recovered = await runTeamworkCoordinator(input);

    expect(recovered.status).toBe("RECONCILIATION_REQUIRED");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(batchGuard.release).toHaveBeenCalledTimes(1);
  });

  it("reconstructs a missing terminal receipt only from validated durable facts", async () => {
    const plan = createPlan(env.taskRoot, ["work-a"]);
    const batchGuard = {
      acquire: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const dispatch = vi.fn(async (context: TeammateDispatchContext) => {
      writeReport(env.taskRoot, context);
    });
    const input = {
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard: batchGuard,
      config,
      runtime: {
        dispatch,
        async wait() {
          return { kind: "report" as const, terminal: true as const };
        },
        async continue() {
          throw new Error("recovered terminal work must not continue");
        },
      },
    };
    const original = await runTeamworkCoordinator(input);
    const session = resolveTeamworkSession({
      sessionId: "parallel",
      cwd: env.projectDir,
    });
    const eventPath = path.join(session.dir, "events.jsonl");
    const lines = fs.readFileSync(eventPath, "utf8").trimEnd().split("\n");
    const receiptLines = lines.filter((line) => {
      const event = JSON.parse(line) as {
        action?: string;
        batchId?: string;
        kind?: string;
      };
      return (
        event.kind === "coordination" &&
        event.batchId === plan.batch_id &&
        event.action === "receipt_recorded"
      );
    });
    expect(receiptLines).toHaveLength(1);
    fs.writeFileSync(
      eventPath,
      `${lines.filter((line) => !receiptLines.includes(line)).join("\n")}\n`,
    );

    const recovered = await runTeamworkCoordinator(input);

    expect(recovered).toEqual(original);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const restored = fs
      .readFileSync(eventPath, "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as { action?: string; batchId?: string })
      .filter(
        (event) =>
          event.batchId === plan.batch_id &&
          event.action === "receipt_recorded",
      );
    expect(restored).toHaveLength(1);
  });

  it("retains capacity when recovery cannot read an uncertain batch", async () => {
    const plan = createPlan(env.taskRoot, ["work-a"]);
    const batchGuard = {
      acquire: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const dispatch = vi.fn(async () => {
      throw new Error("provider launch outcome is unknown");
    });
    const input = {
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard: batchGuard,
      config,
      runtime: {
        dispatch,
        async wait() {
          throw new Error("uncertain attempt must not wait");
        },
        async continue() {
          throw new Error("uncertain attempt must not continue");
        },
      },
    };
    expect((await runTeamworkCoordinator(input)).status).toBe(
      "RECONCILIATION_REQUIRED",
    );
    const ref = resolveTeamworkSession({
      sessionId: "parallel",
      cwd: env.projectDir,
    });
    const events = path.join(ref.dir, "events.jsonl");
    fs.renameSync(events, `${events}.saved`);
    fs.mkdirSync(events);
    await expect(runTeamworkCoordinator(input)).rejects.toThrow();
    expect(batchGuard.acquire).toHaveBeenCalledTimes(1);
    expect(batchGuard.release).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(`${events}.saved`)).toBe(true);
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
