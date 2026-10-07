import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChannel } from "../../src/commands/channel/create.js";
import { channelKill } from "../../src/commands/channel/kill.js";
import { readProcessIdentity } from "../../src/commands/channel/process-identity.js";
import { readChannelEvents } from "../../src/commands/channel/store/events.js";
import { workerFile } from "../../src/commands/channel/store/paths.js";

describe.skipIf(process.platform !== "linux")("lost-supervisor recovery", () => {
  let root: string;
  let child: ChildProcess;
  let previousRoot: string | undefined;
  let previousProject: string | undefined;
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-orphan-test-"));
    previousRoot = process.env.TRELLIS_CHANNEL_ROOT;
    previousProject = process.env.TRELLIS_CHANNEL_PROJECT;
    process.env.TRELLIS_CHANNEL_ROOT = path.join(root, "channels");
    delete process.env.TRELLIS_CHANNEL_PROJECT;
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await createChannel("orphan", { by: "main" });
    child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    await once(child, "spawn");
    fs.writeFileSync(workerFile("orphan", "worker", "pid"), "2147483647");
    fs.writeFileSync(workerFile("orphan", "worker", "worker-pid"), String(child.pid));
  });
  afterEach(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
    if (previousRoot === undefined) delete process.env.TRELLIS_CHANNEL_ROOT;
    else process.env.TRELLIS_CHANNEL_ROOT = previousRoot;
    if (previousProject === undefined) delete process.env.TRELLIS_CHANNEL_PROJECT;
    else process.env.TRELLIS_CHANNEL_PROJECT = previousProject;
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });
  it("preserves recovery evidence when the child identity cannot be verified", async () => {
    fs.writeFileSync(workerFile("orphan", "worker", "worker-identity"), "wrong-birth-identity");
    await expect(channelKill("orphan", { as: "worker" })).rejects.toThrow("Cannot verify orphan worker process identity");
    expect(fs.existsSync(workerFile("orphan", "worker", "pid"))).toBe(true);
    expect(child.exitCode).toBeNull();
    expect((await readChannelEvents("orphan")).some((event) => event.kind === "error")).toBe(false);
  });
  it("terminates a verified orphan before closing durable lifecycle and recovery files", async () => {
    const pid = child.pid;
    if (pid === undefined) throw new Error("test child has no pid");
    const identity = readProcessIdentity(pid);
    if (!identity) throw new Error("test child identity is unavailable");
    fs.writeFileSync(workerFile("orphan", "worker", "worker-identity"), identity);
    await channelKill("orphan", { as: "worker" });
    expect(child.signalCode).toBe("SIGKILL");
    expect(fs.existsSync(workerFile("orphan", "worker", "worker-pid"))).toBe(false);
    expect((await readChannelEvents("orphan")).at(-1)).toMatchObject({ kind: "error", worker: "worker", synthesized: true });
  });
});
