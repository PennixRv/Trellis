import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendEvent,
  createTeamworkSession,
} from "@pennixrv/trellis-core/teamwork";

describe("native Teamwork telemetry CLI contract", () => {
  let root: string;
  const cli = path.resolve("bin/trellis.js");
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-telemetry-"));
    vi.stubEnv("TRELLIS_TEAMWORK_ROOT", path.join(root, "sessions"));
    vi.stubEnv("TRELLIS_TEAMWORK_PROJECT", "fixture");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const query = (...args: string[]): unknown =>
    JSON.parse(
      execFileSync(process.execPath, [cli, "teamwork", ...args, "--json"], {
        encoding: "utf8",
        env: process.env,
      }),
    );

  it("filters exact owners and projects interactive and managed members without duplicating IDs", async () => {
    await createTeamworkSession({
      sessionId: "owned",
      by: "main",
      ownerSessionId: "owner-a",
    });
    await createTeamworkSession({
      sessionId: "other",
      by: "main",
      ownerSessionId: "owner-b",
    });
    await createTeamworkSession({
      sessionId: "global-owned",
      by: "main",
      scope: "global",
      ownerSessionId: "owner-a",
    });
    await appendEvent("owned", {
      kind: "spawned",
      by: "main",
      as: "review",
      provider: "codex",
    });
    await appendEvent("owned", {
      kind: "session_bound",
      by: "review",
      worker: "review",
      sessionId: "interactive-child",
    });
    await appendEvent("owned", {
      kind: "turn_started",
      by: "review",
      worker: "review",
      turnId: "turn",
      inputSeq: 1,
    });
    for (const batchId of ["a", "b"]) {
      await appendEvent("owned", {
        kind: "coordination",
        by: "main",
        batchId,
        entity: "teammate",
        action: "state_transition",
        state: "ASSIGNED",
        teammateId: "same",
        payload: { provider: "codex" },
      });
      await appendEvent("owned", {
        kind: "session_bound",
        by: "same",
        worker: "same",
        batchId,
        sessionId: `${batchId}-child`,
      });
      await appendEvent("owned", {
        kind: "coordination",
        by: "main",
        batchId,
        entity: "teammate",
        action: "state_transition",
        state: "RUNNING",
        teammateId: "same",
      });
    }
    expect(
      query("list", "--all", "--all-projects", "--owner-session", "owner-a"),
    ).toMatchObject([{ name: "owned", ownerSessionId: "owner-a" }]);
    expect(
      query("list", "--all", "--scope", "global", "--owner-session", "owner-a"),
    ).toMatchObject([{ name: "global-owned", ownerSessionId: "owner-a" }]);
    expect(
      query(
        "workers",
        "owned",
        "--include-terminal",
        "--project-key",
        "fixture",
      ),
    ).toMatchObject([
      {
        workerId: "review",
        provider: "codex",
        activity: "mid-turn",
        sessionIds: ["interactive-child"],
      },
      {
        workerId: "a:same",
        provider: "codex",
        activity: "mid-turn",
        sessionIds: ["a-child"],
      },
      {
        workerId: "b:same",
        provider: "codex",
        activity: "mid-turn",
        sessionIds: ["b-child"],
      },
    ]);
    expect(query("sessions", "--owner-session", "owner-a")).toMatchObject({
      schemaVersion: 1,
      ownerSessionId: "owner-a",
      sessionIds: ["a-child", "b-child", "interactive-child"],
      sessionCount: 3,
      coverage: "since_activation",
    });
    expect(query("sessions", "--owner-session", "owner-b")).toMatchObject({
      sessionIds: [],
      sessionCount: 0,
    });
  });

  it("rejects unknown batch providers instead of reporting zero work", async () => {
    await createTeamworkSession({
      sessionId: "unknown",
      by: "main",
      ownerSessionId: "owner-a",
    });
    await appendEvent("unknown", {
      kind: "coordination",
      by: "main",
      batchId: "old",
      entity: "teammate",
      action: "state_transition",
      state: "ASSIGNED",
      teammateId: "missing-provider",
    });
    expect(() => query("workers", "unknown", "--include-terminal")).toThrow();
  });
});
