import fs from "node:fs";
import path from "node:path";

import { resolveTeamworkSession } from "@pennixrv/trellis-core/teamwork";

import {
  loadTeamworkPlan,
  runTeamworkCoordinator,
  readPlanFile,
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
  },
): Promise<void> {
  const cwd = process.cwd();
  const taskRoot = path.resolve(options.task);
  const plan = loadTeamworkPlan(path.resolve(planPath), taskRoot);
  const config = resolveTeammateRuntimeConfig(cwd);
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
    console.log(JSON.stringify(receipt));
    if (receipt.status !== "ALL_ACCEPTED") process.exitCode = 1;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await runtime.shutdown("batch coordinator finished");
  }
}
