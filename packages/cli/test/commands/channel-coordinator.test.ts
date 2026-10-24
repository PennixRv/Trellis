import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createChannel } from "../../src/commands/channel/create.js";
import {
  computeBatchPlanHash,
  type TeammateReport,
} from "../../src/commands/channel/artifact.js";
import {
  runBatchCoordinator,
  type TeammateDispatchContext,
} from "../../src/commands/channel/coordinator.js";
import { readCoordinationState } from "@mindfoldhq/trellis-core/channel";

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
  fs.writeFileSync(
    path.join(projectDir, ".trellis", "agents", "teammate.md"),
    "---\nname: teammate\n---\nReview assigned evidence only.\n",
  );
  const oldRoot = process.env.TRELLIS_CHANNEL_ROOT;
  const oldProject = process.env.TRELLIS_CHANNEL_PROJECT;
  process.env.TRELLIS_CHANNEL_ROOT = path.join(tmpDir, "channels");
  delete process.env.TRELLIS_CHANNEL_PROJECT;
  const originalCwd = process.cwd;
  vi.spyOn(process, "cwd").mockReturnValue(projectDir);
  return { tmpDir, projectDir, taskRoot, oldRoot, oldProject, originalCwd };
}

function teardown(env: TestEnv): void {
  vi.restoreAllMocks();
  if (env.oldRoot === undefined) delete process.env.TRELLIS_CHANNEL_ROOT;
  else process.env.TRELLIS_CHANNEL_ROOT = env.oldRoot;
  if (env.oldProject === undefined) delete process.env.TRELLIS_CHANNEL_PROJECT;
  else process.env.TRELLIS_CHANNEL_PROJECT = env.oldProject;
  fs.rmSync(env.tmpDir, { recursive: true, force: true });
}

function createPlan(taskRoot: string, workIds: string[], maxRetries = 0) {
  const batchId = "batch-1";
  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const work = workIds.map((workId) => {
    const briefPath = path.join("teammates", batchId, workId, "brief.json");
    const briefFile = path.join(taskRoot, briefPath);
    fs.mkdirSync(path.dirname(briefFile), { recursive: true });
    const brief = {
      schema_version: 1,
      task_id: "task-1",
      batch_id: batchId,
      work_id: workId,
      role_id: "teammate",
      provider: "codex",
      summary: `Review the ${workId} source area and return evidence-backed findings.`,
      scope: `Inspect ${workId}`,
      lens: "Find correctness risks and cite evidence",
      deadline,
      source_digest: sourceDigest,
      acceptance: ["Provide cited findings"],
    };
    fs.writeFileSync(briefFile, JSON.stringify(brief));
    return {
      work_id: workId,
      brief_path: briefPath,
      role_id: "teammate",
      provider: "codex",
      summary: brief.summary,
      scope: brief.scope,
      lens: brief.lens,
      brief_digest: computeBatchPlanHash(brief),
      source_digest: sourceDigest,
      acceptance: ["Provide cited findings"],
      max_retries: maxRetries,
    };
  });
  const plan: Record<string, unknown> = {
    schema_version: 1,
    task_id: "task-1",
    batch_id: batchId,
    channel: "parallel",
    requested_capacity: workIds.length > 1 ? 2 : 1,
    deadline,
    work,
    protected_targets: [],
  };
  plan.plan_hash = computeBatchPlanHash(plan);
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
    context.work.workId,
    "attempts",
    context.attemptId,
    "report.json",
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const report: TeammateReport = {
    schemaVersion: 1,
    taskId: context.plan.taskId,
    batchId: context.plan.batchId,
    workId: context.work.workId,
    attemptId: context.attemptId,
    teammateId: context.teammateId,
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
      work_id: report.workId,
      attempt_id: report.attemptId,
      teammate_id: report.teammateId,
      status: report.status,
      source_digest: report.sourceDigest,
      evidence: report.evidence,
    }),
  );
}

function createRelatedPlan(
  taskRoot: string,
  relation: "committee" | "counter",
  maxRetries = 1,
) {
  const plan = createPlan(taskRoot, ["work-primary"], maxRetries);
  const work = plan.work as Record<string, unknown>[];
  const primary = work[0];
  if (!primary) throw new Error("fixture is missing primary work");
  const primaryBriefPath = path.join(taskRoot, String(primary.brief_path));
  const primaryBrief = JSON.parse(
    fs.readFileSync(primaryBriefPath, "utf8"),
  ) as Record<string, unknown>;
  const counter = relation === "counter";
  const group = { id: "review-pair", kind: "committee" };
  const secondBrief: Record<string, unknown> = {
    ...primaryBrief,
    work_id: "work-counter",
    provider: "codex",
    lens: counter
      ? "Challenge assumptions and report distinct evidence"
      : "Review the contract from an independent lens",
    ...(counter ? { counter_of: "work-primary" } : {}),
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
    work_id: "work-counter",
    brief_path: "teammates/batch-1/work-counter/brief.json",
    provider: "codex",
    lens: secondBrief.lens,
    brief_digest: computeBatchPlanHash(secondBrief),
    ...(counter ? { counter_of: "work-primary" } : { evaluation_group: group }),
  };
  if (counter) {
    secondBrief.counter_of = "work-primary";
    fs.writeFileSync(secondBriefPath, JSON.stringify(secondBrief));
    secondWork.brief_digest = computeBatchPlanHash(secondBrief);
  } else {
    primary.evaluation_group = group;
    fs.writeFileSync(primaryBriefPath, JSON.stringify(primaryBrief));
    primary.brief_digest = computeBatchPlanHash(primaryBrief);
    secondWork.brief_digest = computeBatchPlanHash(secondBrief);
  }
  work.push(secondWork);
  plan.requested_capacity = 2;
  plan.plan_hash = computeBatchPlanHash(plan);
  return plan;
}

function appendWork(
  plan: Record<string, unknown>,
  taskRoot: string,
  workId: string,
) {
  const work = plan.work as Record<string, unknown>[];
  const template = work.find((item) => item.work_id === "work-primary");
  if (!template) throw new Error("fixture is missing primary work");
  const brief = JSON.parse(
    fs.readFileSync(path.join(taskRoot, String(template.brief_path)), "utf8"),
  ) as Record<string, unknown>;
  const newBrief = { ...brief, work_id: workId };
  const briefPath = path.join("teammates", "batch-1", workId, "brief.json");
  fs.mkdirSync(path.dirname(path.join(taskRoot, briefPath)), {
    recursive: true,
  });
  fs.writeFileSync(path.join(taskRoot, briefPath), JSON.stringify(newBrief));
  work.push({
    ...template,
    work_id: workId,
    brief_path: briefPath,
    brief_digest: computeBatchPlanHash(newBrief),
  });
  plan.plan_hash = computeBatchPlanHash(plan);
}

const host = {
  foregroundWait: true,
  protectedArtifactWrites: true,
  protectedTargetsReadOnly: true,
  gitStateReadOnly: true,
  attemptArtifactWrites: true,
  nativeDelegationDisabled: true,
  implicitMemoryDisabled: true,
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

describe("Channel teammate coordinator", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = setup();
    await createChannel("parallel", { by: "main" });
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
      runBatchCoordinator({
        plan,
        taskRoot: env.taskRoot,
        cwd: env.projectDir,
        host: { ...host, implicitMemoryDisabled: false },
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
      (result: { kind: "report"; terminal: true; sessionId: string }) => void
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

    const run = runBatchCoordinator({
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        async dispatch(context) {
          dispatched.push(context);
          if (context.work.workId === "work-a")
            return { sessionId: "session-a" };
          if (dispatched.length === 2) resolveTwoStarted();
          if (dispatched.length === 3) resolveThreeStarted();
        },
        wait(context) {
          return new Promise((resolve) => {
            waiters.set(context.work.workId, resolve);
            if (waiters.size === 2) resolveTwoWaiting();
            if (context.work.workId === "work-c") resolveThreeWaiting();
          });
        },
        async continue() {
          throw new Error("no continuation expected");
        },
      },
    });

    await twoStarted;
    await twoWaiting;
    expect(dispatched.map((item) => item.work.workId)).toEqual([
      "work-a",
      "work-b",
    ]);
    const workB = dispatched[1];
    writeReport(env.taskRoot, workB);
    waiters.get("work-b")?.({
      kind: "report",
      terminal: true,
      sessionId: "session-b",
    });

    await threeStarted;
    await threeWaiting;
    expect(dispatched.map((item) => item.work.workId)).toEqual([
      "work-a",
      "work-b",
      "work-c",
    ]);
    for (const workId of ["work-c", "work-a"]) {
      const context = dispatched.find((item) => item.work.workId === workId);
      expect(context).toBeDefined();
      if (!context) throw new Error(`missing dispatch for ${workId}`);
      writeReport(env.taskRoot, context);
      waiters.get(workId)?.({
        kind: "report",
        terminal: true,
        sessionId: workId === "work-a" ? "session-a" : `session-${workId}`,
      });
    }

    const receipt = await run;
    expect(receipt.status).toBe("ALL_ACCEPTED");
    expect(receipt.work.map((item) => item.status)).toEqual([
      "ACCEPTED",
      "ACCEPTED",
      "ACCEPTED",
    ]);
    expect(receipt.capacity).toBe(2);
    const state = await readCoordinationState({
      channel: "parallel",
      cwd: env.projectDir,
    });
    expect(state.batches[0].state).toBe("ALL_ACCEPTED");
    expect(state.work.map((item) => item.state)).toEqual([
      "ACCEPTED",
      "ACCEPTED",
      "ACCEPTED",
    ]);
    expect(state.leases).toEqual([]);
  });

  it("retries a failed attempt once in the same logical slot with a new identity", async () => {
    const plan = createPlan(env.taskRoot, ["work-a"], 1);
    const dispatched: TeammateDispatchContext[] = [];
    const receipt = await runBatchCoordinator({
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
    const receipt = await runBatchCoordinator({
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

  it("waits for the primary before checking counter evidence and retries only the counter on overlap", async () => {
    const plan = createRelatedPlan(env.taskRoot, "counter", 1);
    appendWork(plan, env.taskRoot, "work-third");
    const work = plan.work as Record<string, unknown>[];
    work.sort(
      (left, right) =>
        ["work-counter", "work-primary", "work-third"].indexOf(
          String(left.work_id),
        ) -
        ["work-counter", "work-primary", "work-third"].indexOf(
          String(right.work_id),
        ),
    );
    plan.requested_capacity = 2;
    plan.plan_hash = computeBatchPlanHash(plan);
    const dispatched: TeammateDispatchContext[] = [];
    const waiters = new Map<string, () => void>();
    const run = runBatchCoordinator({
      plan,
      taskRoot: env.taskRoot,
      cwd: env.projectDir,
      host,
      guard,
      config,
      runtime: {
        async dispatch(context) {
          dispatched.push(context);
          writeReport(
            env.taskRoot,
            context,
            context.work.workId === "work-counter" && context.retryCount > 0
              ? [{ id: "e2", locator: "src/other.ts:2", summary: "Distinct." }]
              : undefined,
          );
        },
        wait(context) {
          return new Promise((resolve) => {
            waiters.set(context.attemptId, () =>
              resolve({ kind: "report", terminal: true }),
            );
          });
        },
        async continue() {
          throw new Error("no continuation expected");
        },
      },
    });
    await vi.waitFor(() => expect(waiters.size).toBe(2));
    waiters.get("work-counter.attempt.0")?.();
    await vi.waitFor(() => expect(dispatched).toHaveLength(3));
    await vi.waitFor(async () => {
      const state = await readCoordinationState({
        channel: "parallel",
        cwd: env.projectDir,
      });
      expect(
        state.work.find((item) => item.workId === "work-counter")?.state,
      ).toBe("VALIDATING");
    });
    waiters.get("work-primary.attempt.0")?.();
    await vi.waitFor(() => expect(dispatched).toHaveLength(4));
    waiters.get("work-third.attempt.0")?.();
    waiters.get("work-counter.attempt.1")?.();

    const receipt = await run;
    expect(receipt.status).toBe("ALL_ACCEPTED");
    expect(receipt.retryCounts["work-counter"]).toBe(1);
    expect(dispatched.map((item) => item.attemptId)).toEqual([
      "work-counter.attempt.0",
      "work-primary.attempt.0",
      "work-third.attempt.0",
      "work-counter.attempt.1",
    ]);
  });

  it("derives committee completion in the terminal batch receipt", async () => {
    const plan = createRelatedPlan(env.taskRoot, "committee", 0);
    const receipt = await runBatchCoordinator({
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
              id: context.work.workId,
              locator: `${context.work.workId}.ts:1`,
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
    const receipt = await runBatchCoordinator({
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
          return { kind: "report", terminal: true, sessionId: "session-a" };
        },
      },
    });

    expect(receipt.status).toBe("ALL_ACCEPTED");
    expect(receipt.retryCounts["work-a"]).toBe(0);
    expect(waits).toBe(1);
    expect(dispatched).toHaveLength(1);
    const state = await readCoordinationState({
      channel: "parallel",
      cwd: env.projectDir,
    });
    expect(state.work[0]).toMatchObject({ state: "ACCEPTED", retryCount: 0 });
    expect(state.attempts[0]).toMatchObject({
      state: "REPORT_SUBMITTED",
      sessionId: "session-a",
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

    const receipt = await runBatchCoordinator({
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
    expect(receipt.work[0].status).toBe("UNKNOWN");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(continueAttempt).toHaveBeenCalledTimes(8);
    expect(leaseGuard.release).not.toHaveBeenCalled();
    const state = await readCoordinationState({
      channel: "parallel",
      cwd: env.projectDir,
    });
    expect(state.attempts[0].terminal).not.toBe(true);
    expect(state.work[0].state).toBe("EXECUTING");
    expect(state.leases).toHaveLength(1);
  });

  it("settles failed work only after each unit exhausts its own retry budget", async () => {
    const plan = createPlan(env.taskRoot, ["work-zero", "work-bounded"], 1);
    const work = plan.work as Record<string, unknown>[];
    work[0].max_retries = 0;
    plan.plan_hash = computeBatchPlanHash(plan);
    const dispatched: TeammateDispatchContext[] = [];
    const receipt = await runBatchCoordinator({
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
    expect(receipt.work.map((item) => item.status)).toEqual([
      "FINAL_FAILED",
      "FINAL_FAILED",
    ]);
    expect(receipt.retryCounts).toMatchObject({
      "work-zero": 0,
      "work-bounded": 1,
    });
    expect(dispatched.map((item) => item.work.workId)).toEqual([
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
      runBatchCoordinator({
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
      channel: "parallel",
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
    const receipt = await runBatchCoordinator({
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
          if (context.work.workId === "work-a") {
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
    expect(receipt.work.map((item) => item.status)).toEqual([
      "FINAL_FAILED",
      "FINAL_FAILED",
      "UNKNOWN",
    ]);
    expect(dispatched.map((item) => item.work.workId)).toEqual([
      "work-a",
      "work-b",
    ]);
    expect(cancel).toHaveBeenCalledTimes(1);
    const state = await readCoordinationState({
      channel: "parallel",
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
    const receipt = await runBatchCoordinator({
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
    expect(receipt.work[0].status).toBe("UNKNOWN");
    const state = await readCoordinationState({
      channel: "parallel",
      cwd: env.projectDir,
    });
    expect(state.attempts[0].terminal).not.toBe(true);
  });

  it("records reconciliation after an uncertain dispatch and never redispatches on recovery", async () => {
    const plan = createPlan(env.taskRoot, ["work-a"]);
    const dispatch = vi.fn(async () => {
      throw new Error("provider launch failed after command issue");
    });
    const receipt = await runBatchCoordinator({
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
    expect(receipt.work[0].status).toBe("UNKNOWN");
    const state = await readCoordinationState({
      channel: "parallel",
      cwd: env.projectDir,
    });
    expect(state.batches[0].state).toBe("RECONCILIATION_REQUIRED");
    expect(state.receipts).toEqual(["batch-1:RECONCILIATION_REQUIRED"]);
    expect(state.leases).toHaveLength(1);

    const recovered = await runBatchCoordinator({
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
      runBatchCoordinator({
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
      channel: "parallel",
      cwd: env.projectDir,
    });
    expect(state.batches).toEqual([]);
  });
});
