import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  clearForegroundWait,
  recordForegroundWait,
} from "../../src/commands/teamwork/foreground-wait.js";
import type { TeamworkPlan } from "../../src/commands/teamwork/artifact.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-wait-"));
const original = process.env.CODEX_THREAD_ID;
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  if (original) process.env.CODEX_THREAD_ID = original;
  else delete process.env.CODEX_THREAD_ID;
});

it("guards the owner session until native settlement, preserving original continuation and reconciliation", () => {
  process.env.CODEX_THREAD_ID = "owner";
  const plan = {
    sessionId: "review",
    batchId: "batch",
    planHash: "a".repeat(64),
  } as TeamworkPlan;
  recordForegroundWait(root, plan);
  const hook = path.resolve(
    __dirname,
    "../../src/templates/shared-hooks/guard-teamwork-wait.py",
  );
  const invoke = (session: string, tool: string, command = "") => {
    const result = spawnSync("python3", [hook], {
      encoding: "utf8",
      input: JSON.stringify({
        cwd: root,
        session_id: session,
        tool_name: tool,
        tool_input: { command },
      }),
      env: { ...process.env, TRELLIS_HOOKS: "1" },
    });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout
      ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecision
      : undefined;
  };
  expect(invoke("owner", "Bash", "trellis teamwork batch another.json")).toBe(
    "deny",
  );
  expect(invoke("owner", "Edit")).toBe("deny");
  expect(invoke("other", "Bash")).toBeUndefined();
  expect(invoke("owner", "write_stdin")).toBeUndefined();
  expect(
    invoke("owner", "Bash", "trellis teamwork reconcile plan.json --task task"),
  ).toBeUndefined();
  expect(
    invoke(
      "owner",
      "Bash",
      "trellis teamwork reconcile plan.json; echo bypass",
    ),
  ).toBe("deny");
  clearForegroundWait(root, plan);
  expect(invoke("owner", "Bash")).toBeUndefined();
});
