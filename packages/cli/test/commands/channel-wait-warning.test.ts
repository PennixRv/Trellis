import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createChannel } from "../../src/commands/channel/create.js";
import { registerChannelCommand } from "../../src/commands/channel/index.js";
import { appendEvent } from "../../src/commands/channel/store/events.js";
import { projectKey } from "../../src/commands/channel/store/paths.js";
import {
  SUPERVISOR_TIMEOUT_WARNING_REMAINING_MS,
  scheduleSupervisorTimeoutWarning,
  type SupervisorShutdownProbe,
} from "../../src/commands/channel/supervisor/warning.js";
import {
  channelBarrier,
  channelWait,
} from "../../src/commands/channel/wait.js";
import { readChannelEvents } from "../../src/commands/channel/store/events.js";
import type { ChannelEvent } from "../../src/commands/channel/store/events.js";

const noop = (): void => undefined;

interface TmpEnv {
  tmpDir: string;
  projectDir: string;
  oldRoot: string | undefined;
  oldProject: string | undefined;
}

function setup(): TmpEnv {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "trellis-channel-warning-test-"),
  );
  const projectDir = path.join(tmpDir, "project");
  fs.mkdirSync(projectDir);
  const oldRoot = process.env.TRELLIS_CHANNEL_ROOT;
  const oldProject = process.env.TRELLIS_CHANNEL_PROJECT;
  process.env.TRELLIS_CHANNEL_ROOT = path.join(tmpDir, "channels");
  delete process.env.TRELLIS_CHANNEL_PROJECT;
  return { tmpDir, projectDir, oldRoot, oldProject };
}

function teardown(env: TmpEnv): void {
  if (env.oldRoot === undefined) delete process.env.TRELLIS_CHANNEL_ROOT;
  else process.env.TRELLIS_CHANNEL_ROOT = env.oldRoot;
  if (env.oldProject === undefined) delete process.env.TRELLIS_CHANNEL_PROJECT;
  else process.env.TRELLIS_CHANNEL_PROJECT = env.oldProject;
  fs.rmSync(env.tmpDir, { recursive: true, force: true });
}

async function waitForWarning(
  env: TmpEnv,
  channel: string,
  timeoutMs = 500,
): Promise<ChannelEvent | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await readChannelEvents(channel, projectKey(env.projectDir));
    const warning = events.find((e) => e.kind === "supervisor_warning");
    if (warning) return warning;
    await new Promise((r) => setTimeout(r, 10));
  }
  return undefined;
}

describe("channelWait kind union (CLI)", () => {
  let env: TmpEnv;
  let pendingAppends: Promise<unknown>[];

  function appendSoon(
    name: string,
    partial: Parameters<typeof appendEvent>[1],
    delayMs = 20,
  ): void {
    const p = new Promise<unknown>((resolve, reject) => {
      setTimeout(() => {
        void appendEvent(name, partial).then(resolve, reject);
      }, delayMs);
    });
    pendingAppends.push(p);
  }

  beforeEach(() => {
    env = setup();
    pendingAppends = [];
    vi.spyOn(process, "cwd").mockReturnValue(env.projectDir);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
  });

  afterEach(async () => {
    await Promise.allSettled(pendingAppends);
    pendingAppends = [];
    vi.restoreAllMocks();
    teardown(env);
  });

  it("returns when ANY listed kind arrives (--kind done,killed wakes on killed)", async () => {
    await createChannel("wait-union", { by: "main" });

    const waiter = channelWait("wait-union", {
      as: "main",
      kind: "done,killed",
      from: "worker",
      timeoutMs: 5000,
    });

    appendSoon("wait-union", {
      kind: "killed",
      by: "worker",
      reason: "explicit-kill",
      signal: "SIGTERM",
    });

    await waiter;
    expect(process.exitCode).not.toBe(124);
  });

  it("preserves single-kind behavior (--kind done)", async () => {
    await createChannel("wait-single", { by: "main" });

    const waiter = channelWait("wait-single", {
      as: "main",
      kind: "done",
      from: "worker",
      timeoutMs: 5000,
    });

    appendSoon("wait-single", {
      kind: "done",
      by: "worker",
      duration_ms: 5,
    });

    await waiter;
    expect(process.exitCode).not.toBe(124);
  });

  it("replays a terminal event committed after an explicit barrier", async () => {
    await createChannel("wait-barrier", { by: "main" });
    const barrier = await channelBarrier("wait-barrier");
    await appendEvent("wait-barrier", {
      kind: "done",
      by: "worker",
      duration_ms: 5,
    });
    vi.mocked(console.log).mockClear();

    await channelWait("wait-barrier", {
      as: "main",
      from: "worker",
      kind: "done",
      afterSeq: barrier,
      timeoutMs: 5000,
    });

    expect(console.log).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0][0])),
    ).toMatchObject({
      kind: "done",
      by: "worker",
    });
  });

  it.each([
    {
      kind: "killed",
      by: "supervisor:worker",
      reason: "idle-timeout",
      lifecycle: "killed",
    },
    {
      kind: "killed",
      by: "supervisor:worker",
      reason: "crash",
      lifecycle: "crashed",
    },
    { kind: "error", by: "supervisor:worker", lifecycle: "error" },
    { kind: "error", by: "worker", synthesized: true, lifecycle: "error" },
    { kind: "done", by: "worker", lifecycle: "done" },
  ] as const)(
    "worker wait accepts $lifecycle independent of terminal author",
    async ({ lifecycle, ...terminal }) => {
      await createChannel("worker-terminal", { by: "main" });
      await appendEvent("worker-terminal", {
        kind: "spawned",
        by: "main",
        as: "worker",
        agent: "subnode",
      });
      const barrier = await channelBarrier("worker-terminal");
      await appendEvent("worker-terminal", { ...terminal, worker: "worker" });
      vi.mocked(console.log).mockClear();
      await channelWait("worker-terminal", {
        as: "main",
        workers: "worker",
        afterSeq: barrier,
        timeoutMs: 1000,
      });
      expect(console.log).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse(String(vi.mocked(console.log).mock.calls[0][0])),
      ).toMatchObject({
        workerId: "worker",
        terminal: true,
        lifecycle,
        lastSeq: barrier + 1,
      });
    },
  );

  it("worker --all ignores ordinary errors and peer turn done and accepts each lifecycle once", async () => {
    await createChannel("workers-all", { by: "main" });
    await appendEvent("workers-all", {
      kind: "spawned",
      by: "main",
      as: "sub",
      agent: "subnode",
    });
    await appendEvent("workers-all", {
      kind: "spawned",
      by: "main",
      as: "peer",
      agent: "check",
    });
    const barrier = await channelBarrier("workers-all");
    await appendEvent("workers-all", {
      kind: "error",
      by: "sub",
      message: "503",
    });
    await appendEvent("workers-all", { kind: "done", by: "peer" });
    await appendEvent("workers-all", { kind: "done", by: "sub" });
    await appendEvent("workers-all", {
      kind: "turn_finished",
      by: "sub",
      worker: "sub",
    });
    await appendEvent("workers-all", {
      kind: "killed",
      by: "supervisor:peer",
      worker: "peer",
      reason: "crash",
    });
    vi.mocked(console.log).mockClear();
    await channelWait("workers-all", {
      as: "main",
      workers: "sub,peer",
      all: true,
      afterSeq: barrier,
      timeoutMs: 1000,
    });
    const emitted = vi
      .mocked(console.log)
      .mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(
      emitted.map((worker) => [
        worker.workerId,
        worker.lifecycle,
        worker.lastSeq,
      ]),
    ).toEqual([
      ["sub", "done", barrier + 3],
      ["peer", "crashed", barrier + 5],
    ]);
  });

  it("ignores old terminals even when later ordinary errors update their lastSeq", async () => {
    await createChannel("worker-old", { by: "main" });
    await appendEvent("worker-old", {
      kind: "spawned",
      by: "main",
      as: "old",
      agent: "subnode",
    });
    await appendEvent("worker-old", { kind: "done", by: "old" });
    const barrier = await channelBarrier("worker-old");
    await appendEvent("worker-old", {
      kind: "error",
      by: "old",
      message: "late adapter error",
    });
    vi.mocked(console.log).mockClear();
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const previous = process.exitCode;
    try {
      await channelWait("worker-old", {
        as: "main",
        workers: "old",
        afterSeq: barrier,
        timeoutMs: 80,
      });
      expect(process.exitCode).toBe(124);
      expect(console.log).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith("timeout: still waiting on old\n");
    } finally {
      process.exitCode = previous;
    }
  });

  it("captures a default barrier and waits past adapter error until a supervisor kill", async () => {
    await createChannel("worker-live", { by: "main" });
    await appendEvent("worker-live", {
      kind: "spawned",
      by: "main",
      as: "worker",
      agent: "subnode",
    });
    vi.mocked(console.log).mockClear();
    const waiter = channelWait("worker-live", {
      as: "main",
      workers: "worker",
      timeoutMs: 1000,
    });
    appendSoon("worker-live", { kind: "error", by: "worker", message: "503" });
    appendSoon(
      "worker-live",
      { kind: "killed", by: "supervisor:worker", worker: "worker" },
      40,
    );
    await waiter;
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0][0])),
    ).toMatchObject({ lifecycle: "killed", lastSeq: 4 });
  });

  it.each([
    { from: "worker" },
    { kind: "done" },
    { to: "main" },
    { thread: "t" },
    { action: "status" },
    { includeProgress: true },
  ])("rejects event filters in worker mode: %j", async (filter) => {
    await createChannel("worker-filter", { by: "main" });
    await expect(
      channelWait("worker-filter", {
        as: "main",
        workers: "worker",
        ...filter,
      }),
    ).rejects.toThrow(/cannot be combined with event filters/);
  });

  it("rejects empty workers and wires worker CSV/all/barrier through Commander", async () => {
    await createChannel("worker-argv", { by: "main" });
    await expect(
      channelWait("worker-argv", { as: "main", workers: ", " }),
    ).rejects.toThrow(/non-empty worker CSV/);
    const barrier = await channelBarrier("worker-argv");
    await appendEvent("worker-argv", {
      kind: "killed",
      by: "supervisor:a",
      worker: "a",
    });
    await appendEvent("worker-argv", {
      kind: "error",
      by: "supervisor:b",
      worker: "b",
    });
    vi.mocked(console.log).mockClear();
    const program = new Command();
    registerChannelCommand(program);
    await program.parseAsync([
      "node",
      "trellis",
      "channel",
      "wait",
      "worker-argv",
      "--as",
      "main",
      "--workers",
      "a,b",
      "--all",
      "--after-seq",
      String(barrier),
      "--timeout",
      "1s",
    ]);
    expect(
      vi
        .mocked(console.log)
        .mock.calls.map(([line]) => JSON.parse(String(line)).workerId),
    ).toEqual(["a", "b"]);
  });

  it("prints a durable sequence through the barrier command", async () => {
    await createChannel("command-barrier", { by: "main" });
    await appendEvent("command-barrier", {
      kind: "progress",
      by: "worker",
      text: "ready",
    });
    vi.mocked(console.log).mockClear();
    const program = new Command();
    registerChannelCommand(program);

    await program.parseAsync(
      ["node", "trellis", "channel", "barrier", "command-barrier"],
      { from: "node" },
    );

    expect(console.log).toHaveBeenCalledWith(2);
  });

  it("invalid CSV member surfaces the existing invalid-kind error", async () => {
    await createChannel("wait-bad", { by: "main" });
    await expect(
      channelWait("wait-bad", {
        as: "main",
        kind: "done,nope",
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/Invalid --kind 'nope'/);
  });

  it("--all with a kind union waits for one matching event per listed agent", async () => {
    await createChannel("wait-all-union", { by: "main" });
    vi.mocked(console.log).mockClear();

    const waiter = channelWait("wait-all-union", {
      as: "main",
      kind: "done,killed",
      from: "worker-a,worker-b",
      all: true,
      timeoutMs: 5000,
    });

    appendSoon("wait-all-union", {
      kind: "killed",
      by: "worker-a",
      reason: "explicit-kill",
      signal: "SIGTERM",
    });
    appendSoon(
      "wait-all-union",
      {
        kind: "done",
        by: "worker-b",
        duration_ms: 5,
      },
      40,
    );

    await waiter;
    expect(process.exitCode).not.toBe(124);
    expect(console.log).toHaveBeenCalledTimes(2);
    const emitted = vi
      .mocked(console.log)
      .mock.calls.map(([line]) => JSON.parse(String(line)) as { kind: string });
    expect(emitted.map((e) => e.kind)).toEqual(["killed", "done"]);
  });

  it("plain wait (no --kind) does not wake on supervisor_warning", async () => {
    await createChannel("wait-warn-default", { by: "main" });

    const previous = process.exitCode;
    process.exitCode = 0;

    const waiter = channelWait("wait-warn-default", {
      as: "main",
      from: "supervisor:worker",
      timeoutMs: 150, // short — we expect timeout
    });

    appendSoon("wait-warn-default", {
      kind: "supervisor_warning",
      by: "supervisor:worker",
      worker: "worker",
      reason: "approaching_timeout",
      timeout_ms: 60_000,
      remaining_ms: 30_000,
    });

    await waiter;
    expect(process.exitCode).toBe(124);
    process.exitCode = previous;
  });

  it("explicit --kind supervisor_warning wakes on the warning", async () => {
    await createChannel("wait-warn-explicit", { by: "main" });

    const waiter = channelWait("wait-warn-explicit", {
      as: "main",
      kind: "supervisor_warning",
      from: "supervisor:worker",
      timeoutMs: 5000,
    });

    appendSoon("wait-warn-explicit", {
      kind: "supervisor_warning",
      by: "supervisor:worker",
      worker: "worker",
      reason: "approaching_timeout",
      timeout_ms: 60_000,
      remaining_ms: 30_000,
    });

    await waiter;
    expect(process.exitCode).not.toBe(124);
  });
});

describe("scheduleSupervisorTimeoutWarning", () => {
  let env: TmpEnv;

  beforeEach(() => {
    env = setup();
    vi.spyOn(process, "cwd").mockReturnValue(env.projectDir);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    teardown(env);
  });

  function makeShutdown(
    overrides: Partial<SupervisorShutdownProbe> = {},
  ): SupervisorShutdownProbe {
    return {
      isShuttingDown: () => false,
      hasTerminalEvent: () => false,
      ...overrides,
    };
  }

  it("exposes the 5m default pre-timeout constant for SOT", () => {
    expect(SUPERVISOR_TIMEOUT_WARNING_REMAINING_MS).toBe(300_000);
  });

  it("fires immediately when timeoutMs <= default warning lead time with remaining_ms = timeoutMs", async () => {
    await createChannel("warn-fast", { by: "main" });

    scheduleSupervisorTimeoutWarning({
      channelName: "warn-fast",
      workerName: "worker",
      timeoutMs: 10_000,
      shutdown: makeShutdown(),
      isChildExited: () => false,
      log: { write: noop },
    });

    const warning = await waitForWarning(env, "warn-fast");
    expect(warning).toMatchObject({
      kind: "supervisor_warning",
      by: "supervisor:worker",
      worker: "worker",
      reason: "approaching_timeout",
      timeout_ms: 10_000,
      remaining_ms: 10_000,
    });
  });

  it("uses a custom warning lead time", async () => {
    await createChannel("warn-custom", { by: "main" });

    scheduleSupervisorTimeoutWarning({
      channelName: "warn-custom",
      workerName: "worker",
      timeoutMs: 500,
      warnBeforeMs: 400,
      shutdown: makeShutdown(),
      isChildExited: () => false,
      log: { write: noop },
    });

    const early = await waitForWarning(env, "warn-custom", 50);
    expect(early).toBeUndefined();

    const warning = await waitForWarning(env, "warn-custom", 300);
    expect(warning).toMatchObject({
      timeout_ms: 500,
      remaining_ms: 400,
    });
  });

  it("does not emit when warnBeforeMs <= 0", async () => {
    await createChannel("warn-disabled", { by: "main" });

    scheduleSupervisorTimeoutWarning({
      channelName: "warn-disabled",
      workerName: "worker",
      timeoutMs: 50,
      warnBeforeMs: 0,
      shutdown: makeShutdown(),
      isChildExited: () => false,
      log: { write: noop },
    });

    const warning = await waitForWarning(env, "warn-disabled", 150);
    expect(warning).toBeUndefined();
  });

  it("never emits a second warning for one schedule", async () => {
    await createChannel("warn-once", { by: "main" });

    scheduleSupervisorTimeoutWarning({
      channelName: "warn-once",
      workerName: "worker",
      timeoutMs: 5_000,
      shutdown: makeShutdown(),
      isChildExited: () => false,
      log: { write: noop },
    });

    await waitForWarning(env, "warn-once");
    // Wait extra time to give any duplicate fire a chance to land.
    await new Promise((r) => setTimeout(r, 100));

    const events = await readChannelEvents(
      "warn-once",
      projectKey(env.projectDir),
    );
    const warnings = events.filter((e) => e.kind === "supervisor_warning");
    expect(warnings).toHaveLength(1);
  });

  it("does not emit when the child has already exited", async () => {
    await createChannel("warn-exited", { by: "main" });

    scheduleSupervisorTimeoutWarning({
      channelName: "warn-exited",
      workerName: "worker",
      timeoutMs: 5_000,
      shutdown: makeShutdown(),
      isChildExited: () => true,
      log: { write: noop },
    });

    const warning = await waitForWarning(env, "warn-exited", 150);
    expect(warning).toBeUndefined();
  });

  it("does not emit when shutdown.hasTerminalEvent() is true", async () => {
    await createChannel("warn-terminal", { by: "main" });

    scheduleSupervisorTimeoutWarning({
      channelName: "warn-terminal",
      workerName: "worker",
      timeoutMs: 5_000,
      shutdown: makeShutdown({ hasTerminalEvent: () => true }),
      isChildExited: () => false,
      log: { write: noop },
    });

    const warning = await waitForWarning(env, "warn-terminal", 150);
    expect(warning).toBeUndefined();
  });

  it("does not emit when shutdown.isShuttingDown() is true", async () => {
    await createChannel("warn-shutdown", { by: "main" });

    scheduleSupervisorTimeoutWarning({
      channelName: "warn-shutdown",
      workerName: "worker",
      timeoutMs: 5_000,
      shutdown: makeShutdown({ isShuttingDown: () => true }),
      isChildExited: () => false,
      log: { write: noop },
    });

    const warning = await waitForWarning(env, "warn-shutdown", 150);
    expect(warning).toBeUndefined();
  });

  it("does not block a later killed event (warning is not terminal)", async () => {
    await createChannel("warn-then-kill", { by: "main" });

    scheduleSupervisorTimeoutWarning({
      channelName: "warn-then-kill",
      workerName: "worker",
      timeoutMs: 5_000,
      shutdown: makeShutdown(),
      isChildExited: () => false,
      log: { write: noop },
    });

    await waitForWarning(env, "warn-then-kill");
    await appendEvent("warn-then-kill", {
      kind: "killed",
      by: "supervisor:worker",
      reason: "timeout",
      signal: "SIGTERM",
      timeout_ms: 5_000,
    });

    const events = await readChannelEvents(
      "warn-then-kill",
      projectKey(env.projectDir),
    );
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("supervisor_warning");
    expect(kinds).toContain("killed");
    expect(kinds.indexOf("supervisor_warning")).toBeLessThan(
      kinds.indexOf("killed"),
    );
  });

  it("a cancelled scheduler never fires", async () => {
    await createChannel("warn-cancel", { by: "main" });

    const cancel = scheduleSupervisorTimeoutWarning({
      channelName: "warn-cancel",
      workerName: "worker",
      timeoutMs: 5_000,
      shutdown: makeShutdown(),
      isChildExited: () => false,
      log: { write: noop },
    });
    cancel();

    const warning = await waitForWarning(env, "warn-cancel", 200);
    expect(warning).toBeUndefined();
  });

  it("computes delay = timeoutMs - warnBeforeMs for large timeoutMs (no warning before that)", async () => {
    // timeoutMs = 500ms, warnBeforeMs = 400ms → delay = 100ms.
    await createChannel("warn-delay", { by: "main" });

    scheduleSupervisorTimeoutWarning({
      channelName: "warn-delay",
      workerName: "worker",
      timeoutMs: 500,
      warnBeforeMs: 400,
      shutdown: makeShutdown(),
      isChildExited: () => false,
      log: { write: noop },
    });

    const early = await waitForWarning(env, "warn-delay", 50);
    expect(early).toBeUndefined();

    // Now poll for the full delay.
    const eventual = await waitForWarning(env, "warn-delay", 300);
    expect(eventual).toMatchObject({
      timeout_ms: 500,
      remaining_ms: 400,
    });
  });
});
