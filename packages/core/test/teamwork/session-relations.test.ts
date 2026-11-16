import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appendEvent,
  createTeamworkSession,
  listSessionDescendants,
} from "../../src/teamwork/index.js";
import {
  sessionDir,
  teamworkRoot,
} from "../../src/teamwork/internal/store/paths.js";
import { setupTeamworkSessionTmp, type TmpEnv } from "./setup.js";

describe("owned Codex billing membership", () => {
  let env: TmpEnv;
  beforeEach(() => {
    env = setupTeamworkSessionTmp();
    vi.spyOn(process, "cwd").mockReturnValue(env.projectDir);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    env.cleanup();
  });
  async function bind(
    name: string,
    owner: string,
    child: string,
  ): Promise<void> {
    await createTeamworkSession({
      sessionId: name,
      by: "main",
      ownerSessionId: owner,
    });
    await appendEvent(name, {
      kind: "spawned",
      by: "main",
      as: "worker",
      provider: "codex",
    });
    await appendEvent(name, {
      kind: "session_bound",
      by: "worker",
      worker: "worker",
      sessionId: child,
    });
  }
  const descendants = (ownerSessionId = "root") =>
    listSessionDescendants({ ownerSessionId });

  it("rejects invalid owners before creating a session", async () => {
    for (const ownerSessionId of [
      "",
      " padded",
      "line\nbreak",
      "x".repeat(513),
    ]) {
      await expect(
        createTeamworkSession({
          sessionId: "invalid",
          by: "main",
          ownerSessionId,
        }),
      ).rejects.toThrow("valid owner session");
    }
    expect(fs.existsSync(sessionDir("invalid"))).toBe(false);
  });

  it("retains exact transitive history after cleanup and isolates other owners", async () => {
    expect(await descendants()).toMatchObject({
      coverage: "not_started",
      sessionCount: 0,
      trackingSince: null,
    });
    await bind("first", "root", "child-a");
    await appendEvent("first", {
      kind: "session_bound",
      by: "worker",
      worker: "worker",
      sessionId: "child-a",
    });
    await appendEvent("first", {
      kind: "session_bound",
      by: "worker",
      worker: "worker",
      sessionId: "retry-b",
    });
    await bind("nested", "child-a", "grandchild");
    await bind("other", "other-root", "unrelated");
    fs.rmSync(sessionDir("first"), { recursive: true });
    expect(await descendants()).toMatchObject({
      sessionIds: ["child-a", "grandchild", "retry-b"],
      sessionCount: 3,
      coverage: "since_activation",
    });
    expect((await descendants("other-root")).sessionIds).toEqual(["unrelated"]);
    expect(
      fs.statSync(path.join(teamworkRoot(), ".session-relations.json")).mode &
        0o777,
    ).toBe(0o600);
  });

  it("records managed batch Codex bindings without confusing another batch or provider", async () => {
    await createTeamworkSession({
      sessionId: "batch",
      by: "main",
      ownerSessionId: "root",
    });
    await appendEvent("batch", {
      kind: "spawned",
      by: "main",
      as: "same-worker",
      provider: "codex",
    });
    for (const [batchId, provider] of [
      ["a", "codex"],
      ["b", "copilot"],
    ]) {
      await appendEvent("batch", {
        kind: "coordination",
        by: "main",
        batchId,
        entity: "teammate",
        action: "state_transition",
        state: "ASSIGNED",
        teammateId: "same-worker",
        payload: { provider },
      });
      await appendEvent("batch", {
        kind: "session_bound",
        by: "same-worker",
        batchId,
        worker: "same-worker",
        sessionId: `${batchId}-child`,
      });
    }
    expect((await descendants()).sessionIds).toEqual(["a-child"]);
  });

  it("serializes writers, rejects conflicting parents/cycles, and keeps the previous snapshot on failure", async () => {
    await Promise.all([bind("a", "root", "a"), bind("b", "root", "b")]);
    await bind("other", "other-root", "other");
    await expect(
      appendEvent("other", {
        kind: "session_bound",
        by: "worker",
        worker: "worker",
        sessionId: "a",
      }),
    ).rejects.toThrow("Conflicting session parent");
    await bind("cycle", "a", "leaf");
    await expect(
      appendEvent("cycle", {
        kind: "session_bound",
        by: "worker",
        worker: "worker",
        sessionId: "root",
      }),
    ).rejects.toThrow("Cyclic");
    const file = path.join(teamworkRoot(), ".session-relations.json");
    const before = fs.readFileSync(file, "utf8");
    vi.spyOn(fsp, "rename").mockRejectedValueOnce(
      new Error("atomic rename failed"),
    );
    await expect(
      appendEvent("a", {
        kind: "session_bound",
        by: "worker",
        worker: "worker",
        sessionId: "new",
      }),
    ).rejects.toThrow("atomic rename failed");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(
      fs
        .readdirSync(teamworkRoot())
        .filter((n) => n.includes(".tmp.") || n.endsWith(".lock")),
    ).toEqual([]);
    fs.writeFileSync(file, "broken");
    await expect(descendants()).rejects.toThrow();
  });

  it("reads the retired native ledger and carries it forward without rewriting its source", async () => {
    vi.stubEnv("TRELLIS_TEAMWORK_ROOT", "");
    vi.spyOn(os, "homedir").mockReturnValue(env.tmpDir);
    const legacy = path.join(
      env.tmpDir,
      ".trellis/channels/.session-relations.json",
    );
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    const before = JSON.stringify({
      schemaVersion: 1,
      trackingSince: "2026-10-08T00:00:00Z",
      relations: [
        {
          parentSessionId: "root",
          sessionId: "old",
          provider: "codex",
          firstBoundAt: "2026-10-08T00:00:00Z",
        },
      ],
    });
    fs.writeFileSync(legacy, before, { mode: 0o600 });
    expect(await descendants()).toMatchObject({
      sessionIds: ["old"],
      trackingSince: "2026-10-08T00:00:00Z",
    });
    await bind("new", "root", "new");
    expect((await descendants()).sessionIds).toEqual(["new", "old"]);
    expect(fs.readFileSync(legacy, "utf8")).toBe(before);
  });
});
