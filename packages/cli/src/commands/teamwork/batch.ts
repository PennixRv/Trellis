import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  resolveTeamworkSession,
  readCoordinationState,
} from "@pennixrv/trellis-core/teamwork";
import { readTeammateReport, type TeamworkPlan } from "./artifact.js";
import type { TeamworkResult } from "./result.js";

import {
  loadTeamworkPlan,
  runTeamworkCoordinator,
  readPlanFile,
  type TeamworkReceipt,
} from "./coordinator.js";
import { createTeamworkSession } from "./create.js";
import {
  effectiveTeammateCapacity,
  resolveTeammateRuntimeConfig,
} from "./teammate-config.js";
import { assertTeammateHostCapability } from "./teammate-adapters.js";
import { CLI_TEAMMATE_HOST, createCliCoordinatorRuntime } from "./runtime.js";
import { acquireLock, releaseLock } from "./store/lock.js";
import { projectDir } from "./store/paths.js";
import { scanLiveWorkers } from "./guard.js";
import { readTeamworkEvents } from "./store/events.js";
import {
  batchReservationPath,
  readBatchReservations,
  writeBatchReservation,
} from "./batch-reservation.js";

export async function teamworkBatch(
  planPath: string,
  options: {
    task: string;
    preflight?: boolean;
    json?: boolean;
  },
): Promise<void> {
  const cwd = process.cwd();
  const taskRoot = path.resolve(options.task);
  const plan = loadTeamworkPlan(path.resolve(planPath), taskRoot);
  const config = resolveTeammateRuntimeConfig(
    cwd,
    process.env,
    plan.coordinationMode,
  );
  for (const diagnostic of config.diagnostics ?? [])
    console.error(`[teamwork] ${diagnostic}`);
  const capacity = effectiveTeammateCapacity({
    config,
    requested: plan.requestedCapacity,
    verifiedHostCap: CLI_TEAMMATE_HOST.verifiedHostCap,
  });
  for (const assignment of plan.assignments)
    assertTeammateHostCapability(
      assignment.provider,
      CLI_TEAMMATE_HOST,
      assignment.execution.profile.options,
    );
  if (options.preflight) {
    console.log(
      JSON.stringify({
        status: "ready",
        processProbe: "not_run",
        planHash: plan.planHash,
        assignments: plan.assignments.length,
        capacity,
        capacityPolicy: config,
        rolePolicy: "source-and-git-read-only",
      }),
    );
    return;
  }
  const ref = resolveTeamworkSession({
    sessionId: plan.sessionId,
    cwd,
    forCreate: true,
  });
  if (!fs.existsSync(ref.dir))
    await createTeamworkSession(plan.sessionId, {
      cwd,
      task: options.task,
      by: "main",
      origin: "batch",
      quiet: true,
    });
  const bucket = projectDir(ref.project);
  const lock = path.join(bucket, ".worker-guard.lock");
  const reservationFile = batchReservationPath(
    bucket,
    plan.sessionId,
    plan.batchId,
  );
  const runtime = createCliCoordinatorRuntime(cwd, taskRoot);
  const onSignal = (): void => {
    void runtime.shutdown("batch coordinator interrupted");
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  let output: TeamworkResult | TeamworkReceipt;
  try {
    const receipt = await runTeamworkCoordinator({
      plan: readPlanFile(path.resolve(planPath)),
      taskRoot,
      cwd,
      config,
      host: CLI_TEAMMATE_HOST,
      runtime,
      guard: {
        async acquire(): Promise<void> {
          await acquireLock(lock);
          try {
            const previous = readBatchReservations(bucket).find(
              (item) =>
                item.sessionId === plan.sessionId &&
                item.batchId === plan.batchId,
            );
            if (previous) {
              if (
                previous.planHash !== plan.planHash ||
                previous.capacity !== capacity
              )
                throw new Error(
                  "batch capacity reservation does not match the frozen plan",
                );
              try {
                process.kill(previous.ownerPid, 0);
                throw new Error("batch coordinator is already running");
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ESRCH")
                  throw error;
              }
            }
            const live = scanLiveWorkers({ projectKey: ref.project }).filter(
              (worker) =>
                !(
                  worker.sessionId === plan.sessionId &&
                  worker.workerId.startsWith(`batch:${plan.batchId}:`)
                ),
            );
            if (
              live.length + capacity + config.guard.nonBatchReserved >
              config.guard.maxLiveTeammates
            )
              throw new Error(
                "batch capacity exceeds the remaining live teammate budget",
              );
            writeBatchReservation(bucket, {
              schemaVersion: 1,
              sessionId: plan.sessionId,
              batchId: plan.batchId,
              planHash: plan.planHash,
              capacity,
              ownerPid: process.pid,
            });
          } finally {
            releaseLock(lock);
          }
        },
        async release(): Promise<void> {
          await acquireLock(lock);
          try {
            fs.unlinkSync(reservationFile);
          } finally {
            releaseLock(lock);
          }
        },
      },
    });
    if (options.json) {
      const result = await buildBatchResult(plan, receipt, taskRoot, cwd);
      output = result;
      if (result.reports.some((item) => item.validation === "failed"))
        process.exitCode = 1;
    } else output = receipt;
    if (receipt.status !== "ALL_ACCEPTED") process.exitCode = 1;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await runtime.shutdown("batch coordinator finished");
  }
  console.log(JSON.stringify(output));
}

/** A view over durable facts and validated artifacts; it does not accept task results. */
export async function buildBatchResult(
  plan: TeamworkPlan,
  receipt: TeamworkReceipt,
  taskRoot: string,
  cwd: string,
): Promise<TeamworkResult> {
  const projection = await readCoordinationState({
    sessionId: plan.sessionId,
    cwd,
  });
  const events = await readTeamworkEvents(plan.sessionId);
  const result: TeamworkResult = {
    schemaVersion: 1,
    kind: "trellis_result",
    mode: "batch",
    association: {
      taskId: plan.taskId,
      batchId: plan.batchId,
      sessionId: plan.sessionId,
      planHash: plan.planHash,
    },
    execution: {
      status:
        receipt.status === "RECONCILIATION_REQUIRED"
          ? "uncertain"
          : "completed",
      stopped: receipt.status !== "RECONCILIATION_REQUIRED",
    },
    reports: [],
    semanticValidation: "not_run",
    disposition: receipt.status,
  };
  for (const assignment of plan.assignments) {
    const projected = projection.assignments.find(
      (entry) =>
        entry.batchId === plan.batchId &&
        entry.assignmentId === assignment.assignmentId,
    );
    const attempt = projection.attempts
      .filter(
        (entry) =>
          entry.batchId === plan.batchId &&
          entry.assignmentId === assignment.assignmentId,
      )
      .sort((a, b) => b.lastSeq - a.lastSeq)[0];
    const item: TeamworkResult["reports"][number] = {
      association: { assignmentId: assignment.assignmentId },
      report: null,
      validation: "not_run",
    };
    result.reports.push(item);
    const failure = events
      .filter(
        (event) =>
          event.kind === "coordination" &&
          event.batchId === plan.batchId &&
          event.assignmentId === assignment.assignmentId &&
          event.state === "FINAL_FAILED",
      )
      .pop();
    if (
      failure?.kind === "coordination" &&
      typeof failure.payload?.reason === "string"
    )
      item.error = failure.payload.reason;
    if (!attempt?.attemptId || !attempt.teammateId) {
      if (projected?.state === "ACCEPTED") {
        item.validation = "failed";
        item.error = "Accepted report has no matching attempt identity";
      }
      continue;
    }
    item.association.attemptId = attempt.attemptId;
    item.association.teammateId = attempt.teammateId;
    const file = path.join(
      taskRoot,
      path.dirname(assignment.briefPath),
      "attempts",
      attempt.attemptId,
      "report.json",
    );
    try {
      const report = readTeammateReport({
        taskRoot,
        briefPath: assignment.briefPath,
        attemptId: attempt.attemptId,
        identity: {
          taskId: plan.taskId,
          batchId: plan.batchId,
          assignmentId: assignment.assignmentId,
          teammateId: attempt.teammateId,
          planHash: plan.planHash,
          phaseId: plan.phaseId,
          taskRouteRevision: plan.taskRouteRevision,
          inputRevision: plan.inputRevision,
        },
        sourceDigest: assignment.sourceDigest,
      });
      if (
        assignment.execution.launch.reportVersion === 2 &&
        report.schemaVersion !== 2
      )
        throw new Error("Report does not match the frozen result contract");
      item.report = report.content ?? null;
      item.validation = report.content ? "passed" : "legacy";
      item.artifact = {
        path: file,
        sha256: crypto
          .createHash("sha256")
          .update(fs.readFileSync(file))
          .digest("hex"),
      };
    } catch (error) {
      // Failed attempts may have been cleaned according to the retention contract.
      if (projected?.state !== "ACCEPTED" && !fs.existsSync(file)) continue;
      item.validation = "failed";
      item.error = error instanceof Error ? error.message : String(error);
    }
  }
  return result;
}
