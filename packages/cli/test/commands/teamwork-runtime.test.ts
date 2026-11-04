import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkerChild } from "../../src/commands/teamwork/adapters/index.js";
import { createCliCoordinatorRuntime } from "../../src/commands/teamwork/runtime.js";
import type { TeammateDispatchContext } from "../../src/commands/teamwork/coordinator.js";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
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
});
