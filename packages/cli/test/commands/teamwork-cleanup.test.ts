import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTeamworkSession } from "../../src/commands/teamwork/create.js";
import { teamworkSessionKill } from "../../src/commands/teamwork/kill.js";
import { readProcessIdentity } from "../../src/commands/teamwork/process-identity.js";
import {
  teamworkSessionPrune,
  teamworkSessionRm,
} from "../../src/commands/teamwork/rm.js";
import { readTeamworkEvents } from "../../src/commands/teamwork/store/events.js";
import {
  acquireLock,
  releaseLock,
} from "../../src/commands/teamwork/store/lock.js";
import {
  eventsPath,
  lockPath,
  projectDir,
  sessionDir,
  workerFile,
} from "../../src/commands/teamwork/store/paths.js";

describe("Teamwork cleanup preserves unverified process evidence", () => {
  let root: string;
  let child: ChildProcess | undefined;
  let previousRoot: string | undefined;
  let previousProject: string | undefined;
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-cleanup-test-"));
    previousRoot = process.env.TRELLIS_TEAMWORK_ROOT;
    previousProject = process.env.TRELLIS_TEAMWORK_PROJECT;
    process.env.TRELLIS_TEAMWORK_ROOT = path.join(root, "teamwork");
    delete process.env.TRELLIS_TEAMWORK_PROJECT;
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await createTeamworkSession("cleanup", { by: "main" });
  });
  afterEach(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
    child = undefined;
    if (previousRoot === undefined) delete process.env.TRELLIS_TEAMWORK_ROOT;
    else process.env.TRELLIS_TEAMWORK_ROOT = previousRoot;
    if (previousProject === undefined)
      delete process.env.TRELLIS_TEAMWORK_PROJECT;
    else process.env.TRELLIS_TEAMWORK_PROJECT = previousProject;
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function orphan(): Promise<number> {
    child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    await once(child, "spawn");
    if (!child.pid) throw new Error("test child has no PID");
    fs.writeFileSync(workerFile("cleanup", "teammate", "pid"), "2147483647");
    fs.writeFileSync(
      workerFile("cleanup", "teammate", "worker-pid"),
      String(child.pid),
    );
    return child.pid;
  }
  it("refuses kill and rm for a live unrelated supervisor PID", async () => {
    fs.writeFileSync(
      workerFile("cleanup", "teammate", "pid"),
      String(process.pid),
    );
    const signal = vi.spyOn(process, "kill");
    await expect(
      teamworkSessionKill("cleanup", { as: "teammate", force: true }),
    ).rejects.toThrow("Cannot verify supervisor process identity");
    const preview = await teamworkSessionRm("cleanup");
    expect(preview.eligible).toBe(false);
    await expect(
      teamworkSessionRm("cleanup", { confirm: preview.digest }),
    ).rejects.toThrow("Session evidence protected");
    expect(signal.mock.calls.every(([, value]) => value === 0)).toBe(true);
    expect(fs.existsSync(workerFile("cleanup", "teammate", "pid"))).toBe(true);
  });
  it("rejects malformed PIDs before probing or signalling a process group", async () => {
    const signal = vi.spyOn(process, "kill");
    for (const value of ["-1", "0", "invalid"]) {
      fs.writeFileSync(workerFile("cleanup", "teammate", "pid"), value);
      await expect(
        teamworkSessionKill("cleanup", { as: "teammate" }),
      ).rejects.toThrow("Cannot verify supervisor PID");
    }
    expect(signal).not.toHaveBeenCalled();
  });
  it.skipIf(process.platform === "win32")(
    "stops a verified supervisor through the graceful path",
    async () => {
      child = spawn(
        process.execPath,
        [
          "-e",
          "setInterval(() => {}, 1000)",
          "--",
          "teamwork",
          "__supervisor",
          "cleanup",
          "teammate",
        ],
        { stdio: "ignore" },
      );
      await once(child, "spawn");
      fs.writeFileSync(
        workerFile("cleanup", "teammate", "pid"),
        String(child.pid),
      );
      await teamworkSessionKill("cleanup", { as: "teammate" });
      expect(child.signalCode).toBe("SIGTERM");
      expect(fs.existsSync(workerFile("cleanup", "teammate", "pid"))).toBe(
        false,
      );
    },
  );
  it("preserves an orphan when its birth identity is missing or mismatched", async () => {
    await orphan();
    for (const identity of [undefined, "wrong-birth-identity"]) {
      if (identity)
        fs.writeFileSync(
          workerFile("cleanup", "teammate", "worker-identity"),
          identity,
        );
      await expect(
        teamworkSessionKill("cleanup", { as: "teammate" }),
      ).rejects.toThrow("Cannot verify orphan teammate process identity");
      expect(child?.signalCode).toBeNull();
      expect(
        fs.existsSync(workerFile("cleanup", "teammate", "worker-pid")),
      ).toBe(true);
    }
    expect(
      (await readTeamworkEvents("cleanup")).some(
        (event) => event.kind === "error",
      ),
    ).toBe(false);
  });
  it.skipIf(process.platform !== "linux")(
    "terminates a verified orphan before deleting its runtime evidence",
    async () => {
      const pid = await orphan();
      const identity = readProcessIdentity(pid);
      if (!identity) throw new Error("test child birth identity unavailable");
      fs.writeFileSync(
        workerFile("cleanup", "teammate", "worker-identity"),
        identity,
      );
      await teamworkSessionKill("cleanup", { as: "teammate" });
      expect(child?.signalCode).toBe("SIGKILL");
      expect(
        fs.existsSync(workerFile("cleanup", "teammate", "worker-pid")),
      ).toBe(false);
      expect((await readTeamworkEvents("cleanup")).at(-1)).toMatchObject({
        kind: "error",
        worker: "teammate",
      });
    },
  );
  it("prune retains pending launches, child-only PIDs, and corrupt events", async () => {
    fs.writeFileSync(workerFile("cleanup", "teammate", "spawnlock"), "pending");
    await confirmPrune();
    expect(fs.existsSync(sessionDir("cleanup"))).toBe(true);
    fs.unlinkSync(workerFile("cleanup", "teammate", "spawnlock"));
    fs.writeFileSync(
      workerFile("cleanup", "teammate", "worker-pid"),
      String(process.pid),
    );
    await confirmPrune();
    expect(fs.existsSync(sessionDir("cleanup"))).toBe(true);
    fs.unlinkSync(workerFile("cleanup", "teammate", "worker-pid"));
    fs.appendFileSync(eventsPath("cleanup"), "invalid JSON\n");
    await confirmPrune();
    expect(fs.existsSync(sessionDir("cleanup"))).toBe(true);
  });
  it("prune rechecks changed event content even when its timestamp is unchanged", async () => {
    const preview = await teamworkSessionPrune({ all: true });
    if (!preview) throw new Error("missing prune preview");
    const file = eventsPath("cleanup");
    const first = JSON.parse(fs.readFileSync(file, "utf-8").trim()) as {
      ts: string;
    };
    vi.mocked(console.log).mockImplementationOnce(() => {
      fs.appendFileSync(
        file,
        JSON.stringify({
          kind: "message",
          by: "main",
          seq: 2,
          ts: first.ts,
          text: "new evidence",
        }) + "\n",
      );
    });
    await teamworkSessionPrune({
      all: true,
      yes: true,
      confirm: preview.digest,
    });
    expect(fs.existsSync(sessionDir("cleanup"))).toBe(true);
    expect(console.log).toHaveBeenCalledWith(
      "\nRemoved 0/1 Teamwork session(s)",
    );
  });
  it("prune previews then deletes a settled session with an accurate count", async () => {
    const preview = await teamworkSessionPrune({
      all: true,
      dryRun: true,
      yes: true,
    });
    if (!preview) throw new Error("missing prune preview");
    expect(fs.existsSync(sessionDir("cleanup"))).toBe(true);
    await expect(
      teamworkSessionPrune({ all: true, yes: true }),
    ).rejects.toThrow("exact current");
    await teamworkSessionPrune({
      all: true,
      yes: true,
      confirm: preview.digest,
    });
    expect(fs.existsSync(sessionDir("cleanup"))).toBe(false);
    expect(console.log).toHaveBeenCalledWith(
      "\nRemoved 1/1 Teamwork session(s)",
    );
  });
  it("prune waits for an event writer and preserves its new evidence", async () => {
    const preview = await teamworkSessionPrune({ all: true });
    if (!preview) throw new Error("missing prune preview");
    const lock = lockPath("cleanup");
    await acquireLock(lock);
    const pruning = expect(
      teamworkSessionPrune({ all: true, yes: true, confirm: preview.digest }),
    ).rejects.toThrow("exact current");
    try {
      await vi.waitFor(() => {
        expect(
          fs.existsSync(path.join(projectDir(), ".worker-guard.lock")),
        ).toBe(true);
      });
      expect(fs.existsSync(sessionDir("cleanup"))).toBe(true);
      fs.appendFileSync(
        eventsPath("cleanup"),
        JSON.stringify({
          kind: "message",
          ts: new Date().toISOString(),
          seq: 2,
          by: "main",
          text: "in-flight evidence",
        }) + "\n",
      );
    } finally {
      releaseLock(lock);
      await pruning;
    }
    expect(fs.existsSync(sessionDir("cleanup"))).toBe(true);
  });

  async function confirmPrune(): Promise<void> {
    const preview = await teamworkSessionPrune({ all: true });
    if (preview)
      await teamworkSessionPrune({
        all: true,
        yes: true,
        confirm: preview.digest,
      });
  }

  it("rm defaults to preview and rejects stale or protected confirmations", async () => {
    const preview = await teamworkSessionRm("cleanup", { force: true });
    expect(preview.eligible).toBe(true);
    expect(fs.existsSync(sessionDir("cleanup"))).toBe(true);
    await expect(
      teamworkSessionRm("cleanup", { confirm: "old" }),
    ).rejects.toThrow("preview changed");
    const docs = path.join(root, "docs");
    fs.mkdirSync(docs);
    fs.writeFileSync(
      path.join(docs, "result.json"),
      JSON.stringify({
        kind: "trellis_result",
        association: { sessionId: "cleanup" },
        reports: [],
      }),
    );
    await expect(
      teamworkSessionRm("cleanup", { confirm: preview.digest }),
    ).rejects.toThrow("preview changed");
    const protectedPreview = await teamworkSessionRm("cleanup");
    expect(protectedPreview.eligible).toBe(false);
    expect(protectedPreview.references.protected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "result-or-control" }),
      ]),
    );
    expect(fs.existsSync(sessionDir("cleanup"))).toBe(true);
  });

  it("does not turn an inventory mention into permanent retention", async () => {
    fs.writeFileSync(
      path.join(root, "inventory.md"),
      `Inventory: ${eventsPath("cleanup")}\n`,
    );
    const preview = await teamworkSessionRm("cleanup");
    expect(preview.references.mentions).not.toHaveLength(0);
    expect(preview.eligible).toBe(true);
    await teamworkSessionRm("cleanup", { confirm: preview.digest });
    expect(fs.existsSync(sessionDir("cleanup"))).toBe(false);
  });
});
