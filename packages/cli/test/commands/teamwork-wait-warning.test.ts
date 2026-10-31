import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTeamworkSession } from "../../src/commands/teamwork/create.js";
import { appendEvent } from "../../src/commands/teamwork/store/events.js";
import { projectKey } from "../../src/commands/teamwork/store/paths.js";
import {
  SUPERVISOR_TIMEOUT_WARNING_REMAINING_MS,
  scheduleSupervisorTimeoutWarning,
  type SupervisorShutdownProbe,
} from "../../src/commands/teamwork/supervisor/warning.js";
import { teamworkSessionWait } from "../../src/commands/teamwork/wait.js";
import { readTeamworkEvents } from "../../src/commands/teamwork/store/events.js";
import type { TeamworkEvent } from "../../src/commands/teamwork/store/events.js";

const noop = (): void => undefined;

interface TmpEnv {
  tmpDir: string;
  projectDir: string;
  oldRoot: string | undefined;
  oldProject: string | undefined;
}

function setup(): TmpEnv {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "trellis-teamwork-warning-test-"),
  );
  const projectDir = path.join(tmpDir, "project");
  fs.mkdirSync(projectDir);
  const oldRoot = process.env.TRELLIS_TEAMWORK_ROOT;
  const oldProject = process.env.TRELLIS_TEAMWORK_PROJECT;
  process.env.TRELLIS_TEAMWORK_ROOT = path.join(tmpDir, "teamwork");
  delete process.env.TRELLIS_TEAMWORK_PROJECT;
  return { tmpDir, projectDir, oldRoot, oldProject };
}

function teardown(env: TmpEnv): void {
  if (env.oldRoot === undefined) delete process.env.TRELLIS_TEAMWORK_ROOT;
  else process.env.TRELLIS_TEAMWORK_ROOT = env.oldRoot;
  if (env.oldProject === undefined) delete process.env.TRELLIS_TEAMWORK_PROJECT;
  else process.env.TRELLIS_TEAMWORK_PROJECT = env.oldProject;
  fs.rmSync(env.tmpDir, { recursive: true, force: true });
}

async function waitForWarning(
  env: TmpEnv,
  sessionId: string,
  timeoutMs = 500,
): Promise<TeamworkEvent | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await readTeamworkEvents(sessionId, projectKey(env.projectDir));
    const warning = events.find((e) => e.kind === "supervisor_warning");
    if (warning) return warning;
    await new Promise((r) => setTimeout(r, 10));
  }
  return undefined;
}

describe("teamworkSessionWait kind union (CLI)", () => {
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
    await createTeamworkSession("wait-union", { by: "main" });

    const waiter = teamworkSessionWait("wait-union", {
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
    await createTeamworkSession("wait-single", { by: "main" });

    const waiter = teamworkSessionWait("wait-single", {
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

  it("invalid CSV member surfaces the existing invalid-kind error", async () => {
    await createTeamworkSession("wait-bad", { by: "main" });
    await expect(
      teamworkSessionWait("wait-bad", {
        as: "main",
        kind: "done,nope",
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/Invalid --kind 'nope'/);
  });

  it("--all with a kind union waits for one matching event per listed agent", async () => {
    await createTeamworkSession("wait-all-union", { by: "main" });
    vi.mocked(console.log).mockClear();

    const waiter = teamworkSessionWait("wait-all-union", {
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
    await createTeamworkSession("wait-warn-default", { by: "main" });

    const previous = process.exitCode;
    process.exitCode = 0;

    const waiter = teamworkSessionWait("wait-warn-default", {
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
    await createTeamworkSession("wait-warn-explicit", { by: "main" });

    const waiter = teamworkSessionWait("wait-warn-explicit", {
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
    await createTeamworkSession("warn-fast", { by: "main" });

    scheduleSupervisorTimeoutWarning({
      sessionId: "warn-fast",
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
    await createTeamworkSession("warn-custom", { by: "main" });

    scheduleSupervisorTimeoutWarning({
      sessionId: "warn-custom",
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
    await createTeamworkSession("warn-disabled", { by: "main" });

    scheduleSupervisorTimeoutWarning({
      sessionId: "warn-disabled",
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
    await createTeamworkSession("warn-once", { by: "main" });

    scheduleSupervisorTimeoutWarning({
      sessionId: "warn-once",
      workerName: "worker",
      timeoutMs: 5_000,
      shutdown: makeShutdown(),
      isChildExited: () => false,
      log: { write: noop },
    });

    await waitForWarning(env, "warn-once");
    // Wait extra time to give any duplicate fire a chance to land.
    await new Promise((r) => setTimeout(r, 100));

    const events = await readTeamworkEvents(
      "warn-once",
      projectKey(env.projectDir),
    );
    const warnings = events.filter((e) => e.kind === "supervisor_warning");
    expect(warnings).toHaveLength(1);
  });

  it("does not emit when the child has already exited", async () => {
    await createTeamworkSession("warn-exited", { by: "main" });

    scheduleSupervisorTimeoutWarning({
      sessionId: "warn-exited",
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
    await createTeamworkSession("warn-terminal", { by: "main" });

    scheduleSupervisorTimeoutWarning({
      sessionId: "warn-terminal",
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
    await createTeamworkSession("warn-shutdown", { by: "main" });

    scheduleSupervisorTimeoutWarning({
      sessionId: "warn-shutdown",
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
    await createTeamworkSession("warn-then-kill", { by: "main" });

    scheduleSupervisorTimeoutWarning({
      sessionId: "warn-then-kill",
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

    const events = await readTeamworkEvents(
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
    await createTeamworkSession("warn-cancel", { by: "main" });

    const cancel = scheduleSupervisorTimeoutWarning({
      sessionId: "warn-cancel",
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
    await createTeamworkSession("warn-delay", { by: "main" });

    scheduleSupervisorTimeoutWarning({
      sessionId: "warn-delay",
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
