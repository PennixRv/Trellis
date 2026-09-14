import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createChannel } from "../../src/commands/channel/create.js";
import { appendEvent } from "../../src/commands/channel/store/events.js";
import { channelWorkers } from "../../src/commands/channel/workers.js";

describe("channelWorkers", () => {
  let tmpDir: string;
  let projectDir: string;
  let oldRoot: string | undefined;
  let oldProject: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-channel-workers-"));
    projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir);
    oldRoot = process.env.TRELLIS_CHANNEL_ROOT;
    oldProject = process.env.TRELLIS_CHANNEL_PROJECT;
    process.env.TRELLIS_CHANNEL_ROOT = path.join(tmpDir, "channels");
    delete process.env.TRELLIS_CHANNEL_PROJECT;
    vi.spyOn(process, "cwd").mockReturnValue(projectDir);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (oldRoot === undefined) delete process.env.TRELLIS_CHANNEL_ROOT;
    else process.env.TRELLIS_CHANNEL_ROOT = oldRoot;
    if (oldProject === undefined) delete process.env.TRELLIS_CHANNEL_PROJECT;
    else process.env.TRELLIS_CHANNEL_PROJECT = oldProject;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prints the core worker projection and includes terminal workers on request", async () => {
    await createChannel("subnode-review", { by: "main" });
    await appendEvent("subnode-review", {
      kind: "spawned",
      by: "main",
      as: "active",
      provider: "codex",
    });
    await appendEvent("subnode-review", {
      kind: "spawned",
      by: "main",
      as: "finished",
      provider: "codex",
    });
    await appendEvent("subnode-review", {
      kind: "killed",
      by: "cli:kill",
      worker: "finished",
      reason: "explicit-kill",
    });

    await channelWorkers("subnode-review");
    expect(
      vi
        .mocked(console.log)
        .mock.calls.map(([line]) => String(line))
        .join("\n"),
    ).toContain("active\trunning\tidle");
    expect(
      vi
        .mocked(console.log)
        .mock.calls.map(([line]) => String(line))
        .join("\n"),
    ).not.toContain("finished\tkilled");

    vi.mocked(console.log).mockClear();
    await channelWorkers("subnode-review", {
      includeTerminal: true,
      json: true,
    });
    const workers = JSON.parse(
      String(vi.mocked(console.log).mock.calls[0]?.[0]),
    ) as { workerId: string; lifecycle: string }[];
    expect(workers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workerId: "active", lifecycle: "running" }),
        expect.objectContaining({ workerId: "finished", lifecycle: "killed" }),
      ]),
    );
  });
});
