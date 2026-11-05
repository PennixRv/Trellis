import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  send: vi.fn(),
  rm: vi.fn(),
  kill: vi.fn(),
}));
vi.mock("../../src/commands/teamwork/spawn.js", () => ({
  teamworkSessionSpawn: mocks.spawn,
}));
vi.mock("../../src/commands/teamwork/send.js", () => ({
  teamworkSessionSend: mocks.send,
}));
vi.mock("../../src/commands/teamwork/rm.js", () => ({
  teamworkSessionRm: mocks.rm,
}));
vi.mock("../../src/commands/teamwork/kill.js", () => ({
  teamworkSessionKill: mocks.kill,
}));
import { teamworkSessionRun } from "../../src/commands/teamwork/run.js";
import { appendEvent } from "../../src/commands/teamwork/store/events.js";
import {
  sessionDir,
  workerFile,
} from "../../src/commands/teamwork/store/paths.js";

describe("one-shot Teamwork startup barrier", () => {
  let root: string;
  let previousRoot: string | undefined;
  let previousProject: string | undefined;
  let previousExitCode: typeof process.exitCode;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-run-test-"));
    previousRoot = process.env.TRELLIS_TEAMWORK_ROOT;
    previousProject = process.env.TRELLIS_TEAMWORK_PROJECT;
    previousExitCode = process.exitCode;
    process.env.TRELLIS_TEAMWORK_ROOT = path.join(root, "teamwork");
    delete process.env.TRELLIS_TEAMWORK_PROJECT;
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    mocks.spawn.mockReset();
    mocks.send.mockReset().mockResolvedValue(undefined);
    mocks.rm.mockReset().mockResolvedValue(undefined);
    mocks.kill.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (previousRoot === undefined) delete process.env.TRELLIS_TEAMWORK_ROOT;
    else process.env.TRELLIS_TEAMWORK_ROOT = previousRoot;
    if (previousProject === undefined)
      delete process.env.TRELLIS_TEAMWORK_PROJECT;
    else process.env.TRELLIS_TEAMWORK_PROJECT = previousProject;
    process.exitCode = previousExitCode;
    fs.rmSync(root, { recursive: true, force: true });
  });
  it("observes a done event written before spawn returns", async () => {
    mocks.spawn.mockImplementation(async (name: string) => {
      await appendEvent(name, {
        kind: "message",
        by: "teammate",
        text: JSON.stringify({
          schema_version: 2,
          status: "complete",
          answer: "result",
          evidence: [
            { id: "input", locator: "task-input", summary: "given input" },
          ],
          limitations: [],
          unresolved: [],
          deviations: [],
        }),
      });
      await appendEvent(name, { kind: "done", by: "teammate" });
      return { worker: "teammate", pid: 1234, log: "teammate.log" };
    });
    await teamworkSessionRun({
      name: "early-done",
      provider: "claude",
      message: "run",
      timeoutMs: 100,
    });
    expect(mocks.rm).toHaveBeenCalledWith("early-done", { force: true });
  });
  it("reports an early provider failure and retains the session evidence", async () => {
    mocks.spawn.mockImplementation(async (name: string) => {
      await appendEvent(name, {
        kind: "error",
        by: "supervisor:teammate",
        message: "startup failed",
      });
      return { worker: "teammate", pid: 1234, log: "teammate.log" };
    });
    await expect(
      teamworkSessionRun({
        name: "early-error",
        provider: "claude",
        message: "run",
        timeoutMs: 100,
      }),
    ).rejects.toThrow("startup failed");
    expect(mocks.rm).not.toHaveBeenCalled();
    expect(fs.existsSync(sessionDir("early-error"))).toBe(true);
    expect(process.exitCode).toBe(1);
  });
  it.each([
    { textFile: "missing-prompt.txt" },
    { message: "" },
    { message: "   " },
  ])("rejects invalid input before session creation: %j", async (input) => {
    await expect(
      teamworkSessionRun({ name: "invalid-input", ...input }),
    ).rejects.toThrow();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(sessionDir("invalid-input"))).toBe(false);
  });
  it("observes supervisor killed events and ignores other workers", async () => {
    mocks.spawn.mockImplementation(async (name: string) => {
      await appendEvent(name, { kind: "done", by: "other" });
      await appendEvent(name, {
        kind: "killed",
        by: "supervisor:teammate",
        worker: "teammate",
        reason: "timeout",
      });
      return { worker: "teammate", pid: 1234, log: "teammate.log" };
    });
    await expect(
      teamworkSessionRun({ name: "killed", message: "run", timeoutMs: 100 }),
    ).rejects.toThrow("killed before done: timeout");
    expect(mocks.rm).not.toHaveBeenCalled();
  });
  it("stops a spawned worker after delivery fails and keeps the original error", async () => {
    mocks.spawn.mockImplementation(async (name: string) => {
      fs.writeFileSync(workerFile(name, "teammate", "pid"), "1234");
      return { worker: "teammate", pid: 1234, log: "teammate.log" };
    });
    mocks.send.mockRejectedValue(new Error("delivery failed"));
    mocks.kill.mockRejectedValue(new Error("cannot confirm exit"));
    await expect(
      teamworkSessionRun({ name: "delivery-error", message: "run" }),
    ).rejects.toThrow("delivery failed");
    expect(mocks.kill).toHaveBeenCalledWith("delivery-error", {
      as: "teammate",
    });
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("stop unconfirmed"),
    );
    expect(mocks.rm).not.toHaveBeenCalled();
  });
  it("does not treat a done event without a final message as success", async () => {
    mocks.spawn.mockImplementation(async (name: string) => {
      await appendEvent(name, { kind: "done", by: "teammate" });
      return { worker: "teammate", pid: 1234, log: "teammate.log" };
    });
    await expect(
      teamworkSessionRun({
        name: "empty-result",
        message: "run",
        timeoutMs: 100,
      }),
    ).rejects.toThrow("no final message");
    expect(mocks.rm).not.toHaveBeenCalled();
  });
  it.each(["complete", "blocked", "incomplete", "error"] as const)(
    "returns a normalized machine result for report status %s",
    async (status) => {
      const report = {
        schema_version: 2,
        status,
        answer: "actual result",
        evidence: [
          { id: "input", locator: "task-input", summary: "given data" },
        ],
        limitations: [],
        unresolved: [],
        deviations: [],
      };
      mocks.spawn.mockImplementation(async (name: string) => {
        await appendEvent(name, {
          kind: "message",
          by: "teammate",
          text: JSON.stringify(report),
        });
        await appendEvent(name, { kind: "done", by: "teammate" });
        return { worker: "teammate", pid: 1234, log: "teammate.log" };
      });
      await teamworkSessionRun({
        name: "machine",
        message: "run",
        json: true,
        timeoutMs: 100,
      });
      const calls = vi.mocked(console.log).mock.calls;
      expect(calls).toHaveLength(1);
      const result = JSON.parse(String(calls[0]?.[0]));
      expect(result).toMatchObject({
        kind: "trellis_result",
        execution: { status: "completed", stopped: true },
        semanticValidation: "not_run",
        disposition: "not_applicable",
        reports: [{ report, validation: "passed" }],
      });
      expect(mocks.rm).toHaveBeenCalledTimes(status === "complete" ? 1 : 0);
      expect(process.exitCode).toBe(
        status === "complete" ? previousExitCode : 1,
      );
    },
  );
  it.each(["not-json", "{}"])(
    "rejects invalid content without fabricating completion: %s",
    async (text) => {
      mocks.spawn.mockImplementation(async (name: string) => {
        await appendEvent(name, { kind: "message", by: "teammate", text });
        await appendEvent(name, { kind: "done", by: "teammate" });
        return { worker: "teammate", pid: 1234, log: "teammate.log" };
      });
      await teamworkSessionRun({
        name: "invalid-report",
        message: "run",
        json: true,
        timeoutMs: 100,
      });
      const result = JSON.parse(
        String(vi.mocked(console.log).mock.calls[0]?.[0]),
      );
      expect(result).toMatchObject({
        execution: { status: "completed" },
        reports: [{ report: null, validation: "failed" }],
        semanticValidation: "not_run",
      });
      expect(mocks.rm).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    },
  );
  it("returns machine failure for preflight errors without creating a session", async () => {
    await teamworkSessionRun({ name: "no-input", json: true });
    const result = JSON.parse(
      String(vi.mocked(console.log).mock.calls[0]?.[0]),
    );
    expect(result).toMatchObject({
      execution: { status: "error", stopped: true },
      reports: [],
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(sessionDir("no-input"))).toBe(false);
  });
});
