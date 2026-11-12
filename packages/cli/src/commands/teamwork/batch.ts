import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  resolveTeamworkSession,
  readCoordinationState,
} from "@pennixrv/trellis-core/teamwork";
import {
  readTeammateReport,
  validateTeamworkPlan,
  safePath,
  type TeamworkPlan,
} from "./artifact.js";
import { assertFrozenCoordination } from "./coordination.js";
import {
  recordForegroundWait,
  clearForegroundWait,
} from "./foreground-wait.js";
import type { TeamworkResult } from "./result.js";

import {
  loadTeamworkPlan,
  runTeamworkCoordinator,
  readPlanFile,
  reconcileTeamworkBatch,
  readSettledTeamworkReceipt,
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
  evidenceDigest,
  inspectEvidenceReferences,
} from "./evidence-references.js";
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
  const candidate = validateTeamworkPlan(
    readPlanFile(path.resolve(planPath)),
    taskRoot,
    undefined,
    { allowExpired: true },
  );
  const settled = await readSettledTeamworkReceipt(candidate, cwd);
  if (settled && !options.preflight) {
    console.log(
      JSON.stringify(
        options.json
          ? await buildBatchResult(candidate, settled, taskRoot, cwd)
          : settled,
      ),
    );
    if (!["AWAITING_REVIEW", "ALL_ACCEPTED"].includes(settled.status))
      process.exitCode = 1;
    return;
  }
  const plan = loadTeamworkPlan(path.resolve(planPath), taskRoot);
  assertFrozenCoordination(
    cwd,
    plan.coordinationDigest,
    plan.coordinationSnapshot,
  );
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
    assignmentCount: plan.assignments.length,
    verifiedHostCap: CLI_TEAMMATE_HOST.verifiedHostCap,
  });
  assertFrozenCoordination(
    cwd,
    plan.coordinationDigest,
    plan.coordinationSnapshot,
    {
      mode: plan.coordinationMode,
      maxConcurrency: config.teammate.maxConcurrency,
      guard: config.guard,
    },
  );
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
  const runtime = createCliCoordinatorRuntime(
    cwd,
    taskRoot,
    config.sourceDigest,
  );
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
            const reservations = readBatchReservations(bucket);
            const previous = reservations.find(
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
                !reservations.some(
                  (reservation) =>
                    worker.sessionId === reservation.sessionId &&
                    worker.workerId.startsWith(`batch:${reservation.batchId}:`),
                ),
            );
            const reserved = reservations
              .filter(
                (entry) =>
                  entry.sessionId !== plan.sessionId ||
                  entry.batchId !== plan.batchId,
              )
              .reduce((sum, entry) => sum + entry.capacity, 0);
            if (
              config.guard.maxLiveTeammates > 0 &&
              live.length +
                reserved +
                capacity +
                config.guard.nonBatchReserved >
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
            try {
              recordForegroundWait(cwd, plan, { planPath, taskRoot });
            } catch (error) {
              fs.rmSync(reservationFile, { force: true });
              throw error;
            }
          } finally {
            releaseLock(lock);
          }
        },
        async release(): Promise<void> {
          await acquireLock(lock);
          try {
            fs.unlinkSync(reservationFile);
            clearForegroundWait(cwd, plan);
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
    if (!["AWAITING_REVIEW", "ALL_ACCEPTED"].includes(receipt.status))
      process.exitCode = 1;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await runtime.shutdown("batch coordinator finished");
  }
  console.log(JSON.stringify(output));
}

export async function teamworkReconcile(
  planPath: string,
  options: {
    task: string;
    execute?: boolean;
    reason?: string;
    confirmUnknownProcessExit?: boolean;
    wait?: string;
  },
): Promise<void> {
  if (
    options.wait !== undefined &&
    (options.execute ||
      options.reason !== undefined ||
      options.confirmUnknownProcessExit)
  )
    throw new Error("--wait cannot be combined with disposition options");
  if (
    options.wait !== undefined &&
    !/^(?:[1-9]|[1-5][0-9]|60)$/.test(options.wait)
  )
    throw new Error("--wait must be an integer from 1 to 60 seconds");
  if (options.confirmUnknownProcessExit && !options.execute)
    throw new Error("--confirm-unknown-process-exit requires --execute");
  const cwd = process.cwd();
  const plan = validateTeamworkPlan(
    readPlanFile(path.resolve(planPath)),
    path.resolve(options.task),
    undefined,
    { allowExpired: true },
  );
  const ref = resolveTeamworkSession({ sessionId: plan.sessionId, cwd });
  const bucket = projectDir(ref.project);
  if (options.wait !== undefined) {
    await observeTeamworkBatch(
      plan,
      path.resolve(options.task),
      cwd,
      bucket,
      Number(options.wait),
    );
    return;
  }
  const lock = path.join(bucket, ".worker-guard.lock");
  await acquireLock(lock);
  try {
    const reservation = readBatchReservations(bucket).find(
      (entry) =>
        entry.sessionId === plan.sessionId && entry.batchId === plan.batchId,
    );
    let coordinatorExited = false;
    if (reservation) {
      if (reservation.planHash !== plan.planHash)
        throw new Error("Capacity reservation does not match the frozen plan");
      try {
        process.kill(reservation.ownerPid, 0);
        throw new Error(
          "Batch coordinator is still alive; use the original invocation",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        coordinatorExited = true;
      }
    }
    const result = await reconcileTeamworkBatch({
      plan,
      cwd,
      execute: options.execute,
      reason: options.reason,
      confirmUnknownProcessExit: options.confirmUnknownProcessExit,
      coordinatorExited,
    });
    if (
      options.execute &&
      result.status !== "blocked" &&
      result.status !== "ready"
    ) {
      const reservationFile = batchReservationPath(
        bucket,
        plan.sessionId,
        plan.batchId,
      );
      if (fs.existsSync(reservationFile)) fs.unlinkSync(reservationFile);
      clearForegroundWait(cwd, plan);
    }
    console.log(JSON.stringify(result));
  } finally {
    releaseLock(lock);
  }
}

/** Observe durable facts; the original coordinator keeps execution and cleanup. */
async function observeTeamworkBatch(
  plan: TeamworkPlan,
  taskRoot: string,
  cwd: string,
  bucket: string,
  seconds: number,
): Promise<void> {
  const until = performance.now() + seconds * 1000;
  while (true) {
    const projection = await readCoordinationState({
      sessionId: plan.sessionId,
      cwd,
    });
    const batch = projection.batches.find(
      (entry) => entry.batchId === plan.batchId,
    );
    if (batch && batch.planHash !== plan.planHash)
      throw new Error("Batch does not match the frozen plan");
    const reservation = readBatchReservations(bucket).find(
      (entry) =>
        entry.sessionId === plan.sessionId && entry.batchId === plan.batchId,
    );
    if (reservation && reservation.planHash !== plan.planHash)
      throw new Error("Capacity reservation does not match the frozen plan");
    const snapshot = {
      mode: "observe",
      sessionId: plan.sessionId,
      batchId: plan.batchId,
      planHash: plan.planHash,
      deadline: plan.deadline,
      state: batch?.state ?? null,
    };
    const events = await readTeamworkEvents(plan.sessionId);
    // A terminal transition can precede its receipt append; never repair it here.
    const recorded = events.some(
      (event) =>
        event.kind === "coordination" &&
        event.batchId === plan.batchId &&
        event.action === "receipt_recorded" &&
        event.payload?.status === batch?.state &&
        event.payload?.status !== "RECONCILIATION_REQUIRED",
    );
    if (recorded) {
      const receipt = await readSettledTeamworkReceipt(plan, cwd);
      if (receipt) {
        console.log(
          JSON.stringify({
            ...snapshot,
            outcome: "settled",
            receipt,
            result: await buildBatchResult(plan, receipt, taskRoot, cwd),
          }),
        );
        return;
      }
    }
    let ownerExited = false;
    if (reservation) {
      try {
        process.kill(reservation.ownerPid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH")
          ownerExited = true;
        else {
          console.log(
            JSON.stringify({
              ...snapshot,
              outcome: "blocked",
              blockers: ["Cannot verify the original coordinator process"],
            }),
          );
          return;
        }
      }
    }
    if (ownerExited || batch?.state === "RECONCILIATION_REQUIRED") {
      console.log(
        JSON.stringify({
          ...snapshot,
          outcome: "reconciliation_required",
          blockers: [
            "Preview native reconcile; retain capacity until process exit is verified",
          ],
        }),
      );
      return;
    }
    if (projection.issues.length) {
      console.log(
        JSON.stringify({
          ...snapshot,
          outcome: "blocked",
          blockers: projection.issues,
        }),
      );
      return;
    }
    const remaining = until - performance.now();
    if (remaining <= 0) {
      console.log(
        JSON.stringify({
          ...snapshot,
          outcome: "pending",
          ...(batch &&
          ["AWAITING_REVIEW", "ALL_ACCEPTED", "SETTLED_WITH_FAILURE"].includes(
            batch.state,
          )
            ? {
                blockers: [
                  "Awaiting matching durable receipt; observation does not release capacity",
                ],
              }
            : {}),
        }),
      );
      return;
    }
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(250, remaining)),
    );
  }
}

/** Explicit preview/confirm deletion of settled attempt evidence; never automatic retention. */
export async function cleanupTeamworkAttemptEvidence(
  plan: TeamworkPlan,
  taskRoot: string,
  cwd: string,
  confirm?: string,
): Promise<{
  status: "preview" | "removed" | "partial";
  digest: string;
  files: string[];
  runtimeFiles: string[];
  protected: { scope: string; path: string; reasons: string[] }[];
  references: ReturnType<typeof inspectEvidenceReferences>;
  failed: { scope: string; path: string; reason: string }[];
}> {
  if (!(await readSettledTeamworkReceipt(plan, cwd)))
    throw new Error("Only durably settled batch evidence can be cleaned");
  const ref = resolveTeamworkSession({ sessionId: plan.sessionId, cwd });
  const bucket = projectDir(ref.project);
  const lock = path.join(bucket, ".worker-guard.lock");
  await acquireLock(lock);
  try {
    if (
      readBatchReservations(bucket).some(
        (entry) =>
          entry.sessionId === plan.sessionId && entry.batchId === plan.batchId,
      )
    )
      throw new Error(
        "Batch still has a capacity reservation; reconcile it first",
      );
    const projection = await readCoordinationState({
      sessionId: plan.sessionId,
      cwd,
    });
    const receipt = await readSettledTeamworkReceipt(plan, cwd);
    if (!receipt || projection.issues.length)
      throw new Error("Settled evidence changed or requires reconciliation");
    const candidates: {
      scope: "task" | "project-runtime";
      path: string;
      absolute: string;
      fingerprint: unknown[];
      reasons: string[];
    }[] = [];
    for (const attempt of projection.attempts.filter(
      (entry) => entry.batchId === plan.batchId,
    )) {
      const assignment = plan.assignments.find(
        (entry) => entry.assignmentId === attempt.assignmentId,
      );
      if (
        !assignment ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(attempt.attemptId)
      )
        throw new Error("Invalid settled attempt identity");
      const locations: {
        scope: "task" | "project-runtime";
        relative: string;
      }[] = ["report.json", "worklog.md", "provider-stderr.log"].map(
        (name) => ({
          scope: "task",
          relative: path.join(
            path.dirname(assignment.briefPath),
            "attempts",
            attempt.attemptId,
            name,
          ),
        }),
      );
      locations.push({
        scope: "project-runtime",
        relative: path.join(
          ".trellis/.runtime/teamwork-diagnostics",
          plan.batchId,
          attempt.attemptId,
          "provider-stderr.log",
        ),
      });
      for (const location of locations) {
        const { scope, relative } = location;
        const file = safePath(scope === "task" ? taskRoot : cwd, relative);
        if (!fs.existsSync(file)) continue;
        const stat = fs.lstatSync(file);
        if (!stat.isFile())
          throw new Error("Attempt evidence must be a regular file");
        if (stat.size > 8 * 1024 * 1024)
          throw new Error("Attempt evidence exceeds the bounded cleanup limit");
        const reasons: string[] = [];
        if (scope !== "task") {
          try {
            const sessions = fs
              .readdirSync(bucket, { withFileTypes: true })
              .filter(
                (entry) => entry.isDirectory() && !entry.name.startsWith("."),
              );
            if (sessions.length > 256)
              throw new Error("session scan limit exceeded");
            for (const session of sessions) {
              const events = safePath(
                bucket,
                path.join(session.name, "events.jsonl"),
              );
              if (fs.statSync(events).size > 64 * 1024 * 1024)
                throw new Error("event scan limit exceeded");
              const text = fs.readFileSync(events, "utf8");
              if (
                !text.includes(plan.batchId) ||
                !text.includes(attempt.attemptId)
              )
                continue;
              for (const line of text
                .split("\n")
                .filter((line) => line.trim())) {
                const event = JSON.parse(line) as Record<string, unknown>;
                if (
                  session.name !== plan.sessionId &&
                  event.kind === "coordination" &&
                  event.batchId === plan.batchId &&
                  event.attemptId === attempt.attemptId
                )
                  reasons.push(
                    "Legacy diagnostic identity occurs in another session",
                  );
              }
            }
          } catch {
            reasons.push(
              "Cannot verify the legacy diagnostic's session association",
            );
          }
        }
        candidates.push({
          scope,
          path: relative,
          absolute: file,
          reasons,
          fingerprint: [
            stat.dev,
            stat.ino,
            stat.size,
            stat.mtimeMs,
            stat.ctimeMs,
            crypto
              .createHash("sha256")
              .update(fs.readFileSync(file))
              .digest("hex"),
          ],
        });
      }
    }
    const references = inspectEvidenceReferences(
      cwd,
      candidates.map((item) => item.absolute),
    );
    for (const item of candidates) {
      if (!references.complete) item.reasons.push(...references.issues);
    }
    // A referenced retained report protects its dependencies. A whole eligible
    // attempt bundle may exit together without making its internal links permanent.
    let changed = true;
    while (changed) {
      changed = false;
      for (const reference of references.protected) {
        const source = candidates.find(
          (item) => item.absolute === path.resolve(cwd, reference.source),
        );
        const target = candidates.find(
          (item) => item.absolute === reference.target,
        );
        if (
          target &&
          !target.reasons.length &&
          (!source || source.reasons.length)
        ) {
          target.reasons.push(`${reference.role}: ${reference.source}`);
          changed = true;
        }
      }
    }
    const eligible = candidates.filter((item) => !item.reasons.length);
    const files = eligible
      .filter((item) => item.scope === "task")
      .map((item) => item.path);
    const runtimeFiles = eligible
      .filter((item) => item.scope === "project-runtime")
      .map((item) => item.path);
    const digest = evidenceDigest([
      plan.planHash,
      receipt,
      projection,
      candidates,
      references,
    ]);
    const failed: { scope: string; path: string; reason: string }[] = [];
    if (confirm !== undefined) {
      if (confirm !== digest)
        throw new Error(
          "Cleanup preview changed; inspect a fresh preview before confirming",
        );
      for (const item of eligible) {
        try {
          const file = safePath(
            item.scope === "task" ? taskRoot : cwd,
            item.path,
          );
          const stat = fs.lstatSync(file);
          const fingerprint = [
            stat.dev,
            stat.ino,
            stat.size,
            stat.mtimeMs,
            stat.ctimeMs,
            crypto
              .createHash("sha256")
              .update(fs.readFileSync(file))
              .digest("hex"),
          ];
          if (
            !stat.isFile() ||
            evidenceDigest(fingerprint) !== evidenceDigest(item.fingerprint)
          )
            throw new Error("Evidence changed after confirmation");
          const current = inspectEvidenceReferences(cwd, [item.absolute]);
          const external = current.protected.filter((reference) => {
            const source = eligible.find(
              (candidate) =>
                candidate.absolute === path.resolve(cwd, reference.source),
            );
            if (!source) return true;
            const sourceStat = fs.lstatSync(source.absolute);
            const sourceFingerprint = [
              sourceStat.dev,
              sourceStat.ino,
              sourceStat.size,
              sourceStat.mtimeMs,
              sourceStat.ctimeMs,
              crypto
                .createHash("sha256")
                .update(fs.readFileSync(source.absolute))
                .digest("hex"),
            ];
            return (
              !sourceStat.isFile() ||
              evidenceDigest(sourceFingerprint) !==
                evidenceDigest(source.fingerprint)
            );
          });
          if (!current.complete || external.length)
            throw new Error("Evidence references changed after confirmation");
          fs.unlinkSync(file);
        } catch (error) {
          failed.push({
            scope: item.scope,
            path: item.path,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    return {
      status:
        confirm === undefined
          ? "preview"
          : failed.length
            ? "partial"
            : "removed",
      digest,
      files,
      runtimeFiles,
      protected: candidates
        .filter((item) => item.reasons.length)
        .map(({ scope, path, reasons }) => ({ scope, path, reasons })),
      references,
      failed,
    };
  } finally {
    releaseLock(lock);
  }
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
      ...(plan.retryOf
        ? {
            parentBatchId: plan.retryOf.batchId,
            parentPlanHash: plan.retryOf.planHash,
            approvalRef: plan.retryOf.approvalRef,
          }
        : {}),
    },
    execution: {
      status:
        receipt.status === "RECONCILIATION_REQUIRED"
          ? "uncertain"
          : "completed",
      stopped: receipt.status !== "RECONCILIATION_REQUIRED",
    },
    reports: [],
    attempts: [],
    semanticValidation:
      receipt.status === "ALL_ACCEPTED" ? "passed" : "not_run",
    disposition: receipt.status,
  };
  for (const assignment of plan.assignments) {
    const projected = projection.assignments.find(
      (entry) =>
        entry.batchId === plan.batchId &&
        entry.assignmentId === assignment.assignmentId,
    );
    const attempts = projection.attempts
      .filter(
        (entry) =>
          entry.batchId === plan.batchId &&
          entry.assignmentId === assignment.assignmentId,
      )
      .sort((a, b) => a.lastSeq - b.lastSeq);
    for (const [index, attempt] of (attempts.length
      ? attempts
      : [undefined]
    ).entries()) {
      const item: TeamworkResult["reports"][number] = {
        association: { assignmentId: assignment.assignmentId },
        report: null,
        validation: "not_run",
      };
      result.attempts?.push(item);
      if (index === Math.max(0, attempts.length - 1)) result.reports.push(item);
      const review = events
        .filter(
          (event) =>
            event.kind === "coordination" &&
            event.batchId === plan.batchId &&
            event.assignmentId === assignment.assignmentId &&
            event.attemptId === attempt?.attemptId &&
            typeof event.payload?.reportSha256 === "string",
        )
        .at(-1);
      item.disposition =
        review?.kind === "coordination"
          ? review.state === "ACCEPTED"
            ? "accepted"
            : "rejected"
          : projected?.state === "AWAITING_REVIEW"
            ? "pending"
            : "execution_failed";
      if (review && receipt.status !== "ALL_ACCEPTED")
        result.semanticValidation =
          receipt.status === "AWAITING_REVIEW" ? "partial" : "failed";
      const failure = events
        .filter(
          (event) =>
            event.kind === "coordination" &&
            event.batchId === plan.batchId &&
            event.assignmentId === assignment.assignmentId &&
            (!attempt || event.attemptId === attempt.attemptId) &&
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
      item.worklogPath = path.join(path.dirname(file), "worklog.md");
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
        item.validation = "failed";
        item.error = [
          item.error,
          error instanceof Error ? error.message : String(error),
        ]
          .filter(Boolean)
          .join("; ");
      }
    }
  }
  return result;
}
