import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendEvent,
  createTeamworkSession,
  readTeamworkEvents,
  redactDiagnostic,
} from "../../src/teamwork/index.js";
import { setupTeamworkSessionTmp, type TmpEnv } from "./setup.js";

describe("diagnostic credential boundary", () => {
  let env: TmpEnv;
  beforeEach(() => {
    env = setupTeamworkSessionTmp();
    vi.spyOn(process, "cwd").mockReturnValue(env.projectDir);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    env.cleanup();
  });
  it("redacts nested credential fields and known syntax without mutating the input", () => {
    const input = {
      text: "Bearer SYNTHETIC_CANARY password=SYNTHETIC_CANARY",
      detail: { api_key: "SYNTHETIC_CANARY" },
      seq: 3,
    };
    const output = redactDiagnostic(input);
    expect(JSON.stringify(output)).not.toContain("SYNTHETIC_CANARY");
    expect(output.seq).toBe(3);
    expect(input.detail.api_key).toBe("SYNTHETIC_CANARY");
    expect(redactDiagnostic("ordinary text")).toBe("ordinary text");
  });
  it("persists redacted diagnostics while preserving message payloads and replay identity", async () => {
    await createTeamworkSession({ sessionId: "diagnostics", by: "main" });
    const first = await appendEvent("diagnostics", {
      kind: "error",
      by: "main",
      message: "Bearer SYNTHETIC_CANARY",
      idempotencyKey: "error-1",
    });
    const replay = await appendEvent("diagnostics", {
      kind: "error",
      by: "main",
      message: "Bearer SYNTHETIC_CANARY",
      idempotencyKey: "error-1",
    });
    await appendEvent("diagnostics", {
      kind: "progress",
      by: "main",
      detail: { api_key: "SYNTHETIC_CANARY" },
    });
    const message = await appendEvent("diagnostics", {
      kind: "message",
      by: "main",
      text: "Bearer SYNTHETIC_CANARY",
    });
    expect(replay).toEqual(first);
    const diagnostics = (
      await readTeamworkEvents({ sessionId: "diagnostics" })
    ).filter((event) => event.kind === "error" || event.kind === "progress");
    expect(diagnostics).toHaveLength(2);
    expect(JSON.stringify(diagnostics)).not.toContain("SYNTHETIC_CANARY");
    expect(message.kind === "message" && message.text).toBe(
      "Bearer SYNTHETIC_CANARY",
    );
  });
});
