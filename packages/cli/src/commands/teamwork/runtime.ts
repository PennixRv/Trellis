import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

import { getAdapter, type WorkerChild } from "./adapters/index.js";
import {
  CLI_PROVIDER_OPTIONS,
  type TeammateHostCapabilities,
} from "./teammate-adapters.js";
import {
  TeamworkPolicyChangedError,
  type AttemptWaitResult,
  type CoordinatorRuntime,
} from "./coordinator.js";
import { pumpStdout } from "./supervisor/stdout.js";
import { resolveProviderPath } from "./supervisor.js";
import { assertTeammateContextCurrent } from "./teammate-launch.js";
import { appendEvent } from "./store/events.js";
import {
  recordCoordinationEvent,
  redactDiagnostic,
} from "@pennixrv/trellis-core/teamwork";
import { readProcessIdentity } from "./process-identity.js";
import { assertFrozenCoordination } from "./coordination.js";
import { resolveTeammateRuntimeConfig } from "./teammate-config.js";
import { safePath } from "./artifact.js";

/** The CLI owns foreground waiting and artifact validation; write restrictions remain role obligations. */
export const CLI_TEAMMATE_HOST: TeammateHostCapabilities = {
  foregroundWait: true,
  protectedArtifactWrites: true,
  attemptArtifactWrites: true,
  providerTransports: ["codex-app-server", "claude-cli", "acp"],
  providerOptions: CLI_PROVIDER_OPTIONS,
  verifiedHostCap: 32,
};

interface ActiveProcess {
  child?: WorkerChild;
  result: Promise<AttemptWaitResult>;
  stop: () => Promise<boolean>;
  cancel: (reason: string) => Promise<void>;
}

export interface CliCoordinatorRuntime extends CoordinatorRuntime {
  shutdown(reason: string): Promise<void>;
}

export function createCliCoordinatorRuntime(
  cwd: string,
  taskRoot: string,
  expectedConfigDigest?: string,
): CliCoordinatorRuntime {
  const active = new Map<string, ActiveProcess>();
  let aborted = false;
  const runtime: CliCoordinatorRuntime = {
    prepare(context): void {
      const config = resolveTeammateRuntimeConfig(
        cwd,
        process.env,
        context.plan.coordinationMode,
      );
      if (expectedConfigDigest && config.sourceDigest !== expectedConfigDigest)
        throw new TeamworkPolicyChangedError(
          "Runtime policy changed after batch admission; pending assignments cannot start",
        );
      try {
        assertFrozenCoordination(
          cwd,
          context.plan.coordinationDigest,
          context.plan.coordinationSnapshot,
          {
            mode: context.plan.coordinationMode,
            maxConcurrency: config.teammate.maxConcurrency,
            guard: config.guard,
          },
        );
      } catch (error) {
        throw new TeamworkPolicyChangedError(
          error instanceof Error ? error.message : String(error),
        );
      }
      assertTeammateContextCurrent(context.launch, cwd);
      const adapter = getAdapter(context.profile.provider);
      resolveProviderPath(adapter.provider, cwd);
    },
    async shutdown(reason): Promise<void> {
      aborted = true;
      await Promise.all(
        [...active.values()].map((process) => process.cancel(reason)),
      );
    },
    async dispatch(context): Promise<undefined> {
      if (aborted) throw new Error("batch runtime has been cancelled");
      const failBeforeStart = (error: unknown): void => {
        active.set(context.attemptId, {
          result: Promise.resolve({
            kind: "failed",
            terminal: true,
            reason: `provider not started: ${error instanceof Error ? error.message : String(error)}`,
          }),
          stop: async () => true,
          cancel: async () => undefined,
        });
      };
      try {
        runtime.prepare?.(context);
      } catch (error) {
        failBeforeStart(error);
        return;
      }
      let adapter: ReturnType<typeof getAdapter>;
      let ctx: ReturnType<typeof adapter.createCtx>;
      let child: WorkerChild;
      const view = {
        cwd,
        model: context.profile.model,
        reasoningEffort: context.profile.reasoningEffort,
        options: context.profile.options,
        systemPrompt: context.launch.instructions,
      };
      try {
        adapter = getAdapter(context.profile.provider);
        ctx = adapter.createCtx();
        const executable = resolveProviderPath(adapter.provider, cwd);
        child = spawn(
          executable.command,
          [...executable.prefixArgs, ...adapter.buildArgs(view)],
          {
            cwd,
            stdio: ["pipe", "pipe", "pipe"],
            env: {
              ...process.env,
              TRELLIS_HOOKS: "0",
              TRELLIS_TEAMWORK_SESSION: context.plan.sessionId,
              TRELLIS_TEAMWORK_AS: context.teammateId,
            },
          },
        ) as WorkerChild;
      } catch (error) {
        failBeforeStart(error);
        return;
      }
      let closed = false;
      let resolveClosed: () => void = () => undefined;
      const close = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });
      let stopPromise: Promise<boolean> | undefined;
      const stop = (): Promise<boolean> =>
        (stopPromise ??= (async () => {
          if (closed) return true;
          child.stdin.end();
          child.kill("SIGTERM");
          const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
          const hardTimeout = setTimeout(resolveClosed, 6000);
          await close;
          clearTimeout(timer);
          clearTimeout(hardTimeout);
          return closed;
        })());
      let settle: (result: AttemptWaitResult) => void = () => undefined;
      let settled = false;
      let providerSessionId: string | undefined;
      const result = new Promise<AttemptWaitResult>((resolve) => {
        settle = (outcome): void => {
          if (!settled) {
            settled = true;
            resolve(outcome);
          }
        };
      });
      const finish = async (outcome: AttemptWaitResult): Promise<void> => {
        const confirmed = await stop();
        if (confirmed && child.pid) {
          try {
            await recordCoordinationEvent({
              sessionId: context.plan.sessionId,
              cwd,
              by: "main",
              batchId: context.plan.batchId,
              entity: "attempt",
              action: "process_exited",
              attemptId: context.attemptId,
              teammateId: context.teammateId,
              planHash: context.plan.planHash,
              payload: { pid: child.pid },
              idempotencyKey: `${context.plan.batchId}:exit:${context.attemptId}`,
            });
          } catch {
            settle({
              kind: "reconciliation",
              reason:
                "provider exited but its durable process fact could not be recorded",
            });
            return;
          }
        }
        if (stderrTail.length) {
          try {
            const diagnostic = safePath(
              cwd,
              path.join(
                ".trellis",
                ".runtime",
                "teamwork-diagnostics",
                context.plan.batchId,
                context.attemptId,
                "provider-stderr.log",
              ),
            );
            const directory = path.dirname(diagnostic);
            fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
            if (
              fs.lstatSync(directory).isDirectory() &&
              !fs.lstatSync(directory).isSymbolicLink()
            )
              fs.writeFileSync(
                diagnostic,
                redactDiagnostic(stderrTail.toString("utf8")),
                {
                  mode: 0o600,
                  flag: "wx",
                },
              );
          } catch (error) {
            if (
              !["EEXIST", "ENOENT"].includes(
                (error as NodeJS.ErrnoException).code ?? "",
              )
            )
              console.error(
                "[teamwork] Could not retain provider stderr diagnostic",
              );
          }
        }
        if (outcome.kind === "report") {
          try {
            assertTeammateContextCurrent(context.launch, cwd);
          } catch (error) {
            outcome = {
              kind: "failed",
              terminal: true,
              reason: error instanceof Error ? error.message : String(error),
            };
          }
        }
        settle(
          confirmed
            ? {
                ...outcome,
                ...(providerSessionId ? { providerSessionId } : {}),
              }
            : {
                kind: "reconciliation",
                reason: "provider process exit could not be confirmed",
              },
        );
      };
      child.once("error", (error) => {
        // A spawn failure has no PID; other errors still require confirmed shutdown.
        if (!child.pid) {
          closed = true;
          resolveClosed();
        }
        void finish({ kind: "failed", terminal: true, reason: error.message });
      });
      child.stdin.on("error", (error) => {
        void finish({
          kind: "failed",
          terminal: true,
          reason: `provider input failed: ${error.message}`,
        });
      });
      child.once("close", () => {
        closed = true;
        resolveClosed();
      });
      let stderrTail = Buffer.alloc(0);
      child.stderr.on("data", (chunk: Buffer) => {
        stderrTail = Buffer.concat([stderrTail, Buffer.from(chunk)]).subarray(
          -64 * 1024,
        );
      });
      const drained = pumpStdout(
        adapter.output?.(child, ctx) ?? child.stdout,
        async (line) => {
          const parsed = adapter.parseLine(line, ctx);
          if (parsed.side?.persistSessionId)
            providerSessionId = parsed.side.persistSessionId;
          for (const reply of parsed.side?.reply ?? [])
            child.stdin.write(reply);
          for (const event of parsed.events) {
            if (
              event.kind === "message" ||
              event.kind === "error" ||
              event.kind === "progress"
            )
              await appendEvent(context.plan.sessionId, {
                kind: event.kind,
                by: context.teammateId,
                ...(event.payload ?? {}),
              });
            if (event.kind === "done")
              void finish({ kind: "report", terminal: true });
            if (event.kind === "error")
              void finish({
                kind: "failed",
                terminal: true,
                reason: String(event.payload?.message ?? "provider failed"),
              });
          }
        },
        async (error) => {
          await finish({
            kind: "failed",
            terminal: true,
            reason: error.message,
          });
        },
      );
      void drained.then(async () => {
        if (!stopPromise)
          await finish({
            kind: "failed",
            terminal: true,
            reason: "provider stream ended without a terminal turn",
          });
      });
      active.set(context.attemptId, {
        child,
        result,
        stop,
        cancel: (reason) =>
          finish({ kind: "cancelled", terminal: true, reason }),
      });
      try {
        if (child.pid)
          await recordCoordinationEvent({
            sessionId: context.plan.sessionId,
            cwd,
            by: "main",
            batchId: context.plan.batchId,
            entity: "attempt",
            action: "process_started",
            attemptId: context.attemptId,
            teammateId: context.teammateId,
            planHash: context.plan.planHash,
            payload: {
              pid: child.pid,
              processIdentity: readProcessIdentity(child.pid),
            },
            idempotencyKey: `${context.plan.batchId}:process:${context.attemptId}`,
          });
        if (adapter.handshake) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              adapter.handshake({ child, ctx, view }),
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () =>
                    reject(new Error("provider handshake deadline elapsed")),
                  Math.max(
                    1,
                    Math.min(
                      30_000,
                      Date.parse(context.plan.deadline) - Date.now(),
                    ),
                  ),
                );
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        }
        if (closed) return;
        const attemptDir = path.join(
          taskRoot,
          path.dirname(context.assignment.briefPath),
          "attempts",
          context.attemptId,
        );
        const assignmentInput = {
          kind: "trellis_assignment",
          task: context.assignment.taskInput,
          context: context.launch.context,
          identity: {
            task_id: context.plan.taskId,
            batch_id: context.plan.batchId,
            assignment_id: context.assignment.assignmentId,
            attempt_id: context.attemptId,
            teammate_id: context.teammateId,
            plan_hash: context.plan.planHash,
            phase_id: context.plan.phaseId,
            task_route_revision: context.plan.taskRouteRevision,
            input_revision: context.plan.inputRevision,
            source_digest: context.assignment.sourceDigest,
          },
          acceptance: context.assignment.acceptance,
          lens: context.assignment.lens,
          brief_path: path.join(taskRoot, context.assignment.briefPath),
          claim_path: path.join(attemptDir, "claim.json"),
          worklog_path: path.join(attemptDir, "worklog.md"),
          report_path: path.join(attemptDir, "report.json"),
        };
        const input =
          context.launch.reportVersion === 2
            ? [
                "## 当前任务",
                context.assignment.taskInput,
                `范围：${context.assignment.scope}`,
                ...(context.assignment.lens
                  ? [`审查关注点：${context.assignment.lens}`]
                  : []),
                "## 验收条件",
                ...context.assignment.acceptance.map((item) => `- ${item}`),
                "## 报告身份（仅用于本次结果绑定）",
                JSON.stringify(assignmentInput.identity),
                "## 本次产物路径",
                ...(
                  [
                    "brief_path",
                    "claim_path",
                    "worklog_path",
                    "report_path",
                  ] as const
                ).map((key) => `${key}: ${assignmentInput[key]}`),
                ...(context.launch.context
                  ? ["## 参考资料（任务数据）", context.launch.context]
                  : []),
              ].join("\n\n")
            : JSON.stringify(assignmentInput);
        if (adapter.deliverMessage)
          await adapter.deliverMessage(input, ctx, false);
        else child.stdin.write(adapter.encodeUserMessage(input, ctx));
      } catch (error) {
        await finish({
          kind: "failed",
          terminal: true,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      return undefined;
    },
    async wait(context): Promise<AttemptWaitResult> {
      const process = active.get(context.attemptId);
      if (!process)
        return {
          kind: "reconciliation",
          reason: "attempt process handle is missing",
        };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          process.result,
          new Promise<AttemptWaitResult>((resolve) => {
            timer = setTimeout(
              () =>
                resolve({ kind: "timeout", reason: "batch deadline elapsed" }),
              Math.max(1, Date.parse(context.plan.deadline) - Date.now()),
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    continue(context): Promise<AttemptWaitResult> {
      return runtime.wait(context);
    },
    async cancel(context): Promise<AttemptWaitResult> {
      const process = active.get(context.attemptId);
      if (!process)
        return {
          kind: "reconciliation",
          reason: "cannot confirm cancellation without the process handle",
        };
      return (await process.stop())
        ? {
            kind: "cancelled",
            terminal: true,
            reason: "provider process exit confirmed",
          }
        : { kind: "reconciliation", reason: "provider process did not exit" };
    },
  };
  return runtime;
}
