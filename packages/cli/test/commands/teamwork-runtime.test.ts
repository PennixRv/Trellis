import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkerChild } from "../../src/commands/teamwork/adapters/index.js";
import { createCliCoordinatorRuntime } from "../../src/commands/teamwork/runtime.js";
import type { TeammateDispatchContext } from "../../src/commands/teamwork/coordinator.js";

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

afterEach(() => vi.resetAllMocks());

describe("CLI Teamwork coordinator runtime", () => {
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
      const context = {
        plan: {
          sessionId: "diagnostic-session",
          deadline: new Date(Date.now() + 5000).toISOString(),
        },
        assignment: { briefPath: "brief.json" },
        attemptId: "diagnostic-attempt",
        teammateId: "diagnostic-worker",
        profile: { provider: "claude", options: {} },
        launch: { instructions: "Read-only review.", context: "" },
      } as unknown as TeammateDispatchContext;
      const runtime = createCliCoordinatorRuntime("/tmp", "/tmp/task");
      await runtime.dispatch(context);
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
      await runtime.shutdown("test complete");
    },
  );
});
