import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  send: vi.fn(),
  rm: vi.fn(),
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
import { teamworkSessionRun } from "../../src/commands/teamwork/run.js";
import { appendEvent } from "../../src/commands/teamwork/store/events.js";
import { sessionDir } from "../../src/commands/teamwork/store/paths.js";

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
    mocks.spawn.mockReset();
    mocks.send.mockReset().mockResolvedValue(undefined);
    mocks.rm.mockReset().mockResolvedValue(undefined);
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
        by: "teammate",
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
});
