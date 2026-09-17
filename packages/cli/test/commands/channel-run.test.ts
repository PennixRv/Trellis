import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  channelSpawn: vi.fn(),
  channelSend: vi.fn(),
  channelRm: vi.fn(),
}));

vi.mock("../../src/commands/channel/spawn.js", async (importOriginal) => ({
  ...(await importOriginal()),
  channelSpawn: mocks.channelSpawn,
}));
vi.mock("../../src/commands/channel/send.js", () => ({
  channelSend: mocks.channelSend,
}));
vi.mock("../../src/commands/channel/rm.js", () => ({
  channelRm: mocks.channelRm,
}));

import { appendEvent, readChannelEvents } from "../../src/commands/channel/store/events.js";
import { projectKey } from "../../src/commands/channel/store/paths.js";
import { channelRun } from "../../src/commands/channel/run.js";

describe("channelRun startup barrier", () => {
  let tmpDir: string;
  let projectDir: string;
  let oldRoot: string | undefined;
  let oldProject: string | undefined;
  let oldExitCode: number | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-channel-run-test-"));
    projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir);
    oldRoot = process.env.TRELLIS_CHANNEL_ROOT;
    oldProject = process.env.TRELLIS_CHANNEL_PROJECT;
    oldExitCode = process.exitCode;
    process.env.TRELLIS_CHANNEL_ROOT = path.join(tmpDir, "channels");
    delete process.env.TRELLIS_CHANNEL_PROJECT;
    vi.spyOn(process, "cwd").mockReturnValue(projectDir);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.channelSpawn.mockReset();
    mocks.channelSend.mockReset();
    mocks.channelRm.mockReset();
    mocks.channelSend.mockResolvedValue(undefined);
    mocks.channelRm.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (oldRoot === undefined) delete process.env.TRELLIS_CHANNEL_ROOT;
    else process.env.TRELLIS_CHANNEL_ROOT = oldRoot;
    if (oldProject === undefined) delete process.env.TRELLIS_CHANNEL_PROJECT;
    else process.env.TRELLIS_CHANNEL_PROJECT = oldProject;
    process.exitCode = oldExitCode;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not hide a terminal event emitted during spawn", async () => {
    mocks.channelSpawn.mockImplementation(async (channel: string) => {
      await appendEvent(channel, { kind: "done", by: "worker" });
      return { pid: 1234, log: "worker.log", worker: "worker" };
    });

    await channelRun({
      name: "startup-terminal",
      cwd: projectDir,
      provider: "claude",
      as: "worker",
      message: "run",
      timeoutMs: 100,
    });

    expect(mocks.channelSpawn).toHaveBeenCalledOnce();
    expect(mocks.channelSend).toHaveBeenCalledOnce();
    expect(mocks.channelRm).toHaveBeenCalledWith("startup-terminal", { force: true });
    await expect(
      readChannelEvents("startup-terminal", projectKey(projectDir)),
    ).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "done", by: "worker" }),
    ]));
  });

  it("uses the subnode role timeout for one-shot subnode dispatch", async () => {
    fs.mkdirSync(path.join(projectDir, ".trellis"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".trellis", "config.yaml"),
      [
        "channel:",
        "  subnode:",
        "    timeout: 2m",
        "    warn_before: 5s",
      ].join("\n"),
    );
    mocks.channelSpawn.mockImplementation(async (channel: string) => {
      await appendEvent(channel, { kind: "done", by: "worker" });
      return { pid: 1234, log: "worker.log", worker: "worker" };
    });

    await channelRun({
      name: "subnode-role-default",
      cwd: projectDir,
      agent: "subnode",
      as: "worker",
      message: "run",
    });

    expect(mocks.channelSpawn).toHaveBeenCalledWith(
      "subnode-role-default",
      expect.objectContaining({
        timeoutMs: 2 * 60_000,
        warnBeforeMs: 5_000,
      }),
    );
  });

  it("persists an explicit owner before spawning a one-shot Codex worker", async () => {
    mocks.channelSpawn.mockImplementation(async (channel: string) => {
      await appendEvent(channel, { kind: "done", by: "worker" });
      return { pid: 1234, log: "worker.log", worker: "worker" };
    });

    await channelRun({
      name: "owned-one-shot",
      cwd: projectDir,
      provider: "codex",
      as: "worker",
      message: "run",
      ownerSession: "main-thread",
      timeoutMs: 100,
    });

    await expect(
      readChannelEvents("owned-one-shot", projectKey(projectDir)),
    ).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "create",
        ownerSessionId: "main-thread",
      }),
    ]));
  });
});
