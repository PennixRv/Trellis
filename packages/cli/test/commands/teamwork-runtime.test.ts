import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkerChild } from "../../src/commands/teamwork/adapters/index.js";
import { createCliCoordinatorRuntime } from "../../src/commands/teamwork/runtime.js";
import type { TeammateDispatchContext } from "../../src/commands/teamwork/coordinator.js";
import { readCoordinationConfig } from "../../src/commands/teamwork/coordination.js";

const { spawnMock, appendEventMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  appendEventMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("../../src/commands/teamwork/store/events.js", () => ({
  appendEvent: appendEventMock,
}));
vi.mock("../../src/commands/teamwork/supervisor.js", () => ({
  resolveProviderPath: () => ({ command: "claude", prefixArgs: [] }),
}));

const temporary: string[] = [];
afterEach(() => {
  vi.resetAllMocks();
  for (const root of temporary.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("CLI Teamwork coordinator runtime", () => {
  it("closes admission when policy changes after reservation", () => {
    const runtime = createCliCoordinatorRuntime(
      "/tmp",
      "/tmp/task",
      "stale-policy",
    );
    expect(() =>
      runtime.prepare?.({
        plan: { coordinationMode: "general" },
      } as TeammateDispatchContext),
    ).toThrow(/policy changed/);
    expect(spawnMock).not.toHaveBeenCalled();
  });
  it("continues waiting on the same process without resending work or extending the deadline", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    }) as unknown as WorkerChild;
    child.kill = vi.fn(() => {
      queueMicrotask(() => child.emit("close", 0, null));
      return true;
    });
    spawnMock.mockReturnValue(child);

    const context = {
      plan: {
        sessionId: "session-runtime-test",
        deadline: new Date(Date.now() + 40).toISOString(),
        taskId: "task-runtime-test",
        batchId: "batch-runtime-test",
        planHash: "a".repeat(64),
        phaseId: "decision_space_construction_and_merging",
        taskRouteRevision: "1",
        inputRevision: "1",
        coordinationMode: "general",
        coordinationDigest: readCoordinationConfig("/tmp").configDigest,
      },
      assignment: {
        assignmentId: "work-runtime-test",
        briefPath: "teammates/batch-runtime-test/work-runtime-test/brief.json",
        taskInput: "Return a cited finding.",
        acceptance: ["Provide cited findings"],
        lens: "Inspect the assigned source",
        sourceDigest: "b".repeat(64),
      },
      attemptId: "attempt-runtime-test",
      teammateId: "teammate-runtime-test",
      retryCount: 0,
      profile: { provider: "claude", model: "test-model", options: {} },
      launch: { instructions: "Read-only review.", context: "source context" },
    } as unknown as TeammateDispatchContext;
    const stdin: string[] = [];
    child.stdin.on("data", (chunk: Buffer) => stdin.push(chunk.toString()));
    const runtime = createCliCoordinatorRuntime("/tmp", "/tmp/task");

    await runtime.dispatch(context);
    const firstPrompt = stdin.join("");
    expect(firstPrompt).not.toBe("");
    expect(await runtime.wait(context)).toMatchObject({ kind: "timeout" });
    expect(await runtime.continue(context)).toMatchObject({ kind: "timeout" });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(stdin.join("")).toBe(firstPrompt);
    expect(await runtime.cancel(context)).toMatchObject({
      kind: "cancelled",
      terminal: true,
    });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it.each([false, true])(
    "retains provider evidence before terminal settlement (error=%s)",
    async (isError) => {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      }) as unknown as WorkerChild;
      child.kill = vi.fn(() => {
        queueMicrotask(() => child.emit("close", 0, null));
        return true;
      });
      spawnMock.mockReturnValue(child);
      const taskRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "trellis-stderr-"),
      );
      temporary.push(taskRoot);
      fs.mkdirSync(path.join(taskRoot, ".trellis"), { recursive: true });
      const context = {
        plan: {
          sessionId: "diagnostic-session",
          deadline: new Date(Date.now() + 5000).toISOString(),
          coordinationMode: "general",
          coordinationDigest: readCoordinationConfig(taskRoot).configDigest,
          batchId: "diagnostic-batch",
        },
        assignment: { briefPath: "brief.json" },
        attemptId: "diagnostic-attempt",
        teammateId: "diagnostic-worker",
        profile: { provider: "claude", options: {} },
        launch: { instructions: "Read-only review.", context: "" },
      } as unknown as TeammateDispatchContext;
      const attemptRoot = path.join(taskRoot, "attempts", "diagnostic-attempt");
      fs.mkdirSync(attemptRoot, { recursive: true });
      const runtime = createCliCoordinatorRuntime(taskRoot, taskRoot);
      await runtime.dispatch(context);
      child.stderr.write("x".repeat(70000) + "provider authentication failed");
      child.stdout.write(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Read", input: { file: "brief.json" } },
              { type: "text", text: "report artifact was not written" },
            ],
          },
        }) + "\n",
      );
      child.stdout.write(
        JSON.stringify({
          type: "result",
          is_error: isError,
          result: "provider refused",
        }) + "\n",
      );
      expect(await runtime.wait(context)).toMatchObject({
        kind: isError ? "failed" : "report",
        terminal: true,
      });
      expect(appendEventMock).toHaveBeenCalledWith("diagnostic-session", {
        kind: "progress",
        by: "diagnostic-worker",
        detail: { tool: "Read", input_summary: '{"file":"brief.json"}' },
      });
      expect(appendEventMock).toHaveBeenCalledWith("diagnostic-session", {
        kind: "message",
        by: "diagnostic-worker",
        text: "report artifact was not written",
      });
      if (isError)
        expect(appendEventMock).toHaveBeenCalledWith(
          "diagnostic-session",
          expect.objectContaining({
            kind: "error",
            message: "provider refused",
          }),
        );
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      const diagnostic = path.join(
        taskRoot,
        ".trellis/.runtime/teamwork-diagnostics/diagnostic-batch/diagnostic-attempt/provider-stderr.log",
      );
      expect(fs.statSync(diagnostic).size).toBe(64 * 1024);
      expect(fs.readFileSync(diagnostic, "utf8")).toContain(
        "provider authentication failed",
      );
      if (process.platform !== "win32")
        expect(fs.statSync(diagnostic).mode & 0o777).toBe(0o600);
      await runtime.shutdown("test complete");
    },
  );
});
