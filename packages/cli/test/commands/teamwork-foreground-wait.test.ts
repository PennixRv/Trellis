import { afterEach, beforeEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  clearForegroundWait,
  recordForegroundWait,
  foregroundWaitFile,
} from "../../src/commands/teamwork/foreground-wait.js";
import type { TeamworkPlan } from "../../src/commands/teamwork/artifact.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-wait-"));
});
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
  const task = path.join(root, ".trellis", "tasks", "task");
  const file = path.join(task, "plan.json");
  fs.mkdirSync(task, { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      session_id: plan.sessionId,
      batch_id: plan.batchId,
      plan_hash: plan.planHash,
    }),
  );
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
    invoke(
      "owner",
      "Bash",
      `trellis teamwork reconcile ${file} --task ${task}`,
    ),
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

it("provides a native locator and only admits matching, bounded recovery commands", () => {
  process.env.CODEX_THREAD_ID = "owner";
  const task = path.join(root, ".trellis", "tasks", "task with spaces");
  const file = path.join(task, "plan.json");
  fs.mkdirSync(task, { recursive: true });
  const plan = {
    sessionId: "s",
    batchId: "b",
    planHash: "a".repeat(64),
    deadline: new Date().toISOString(),
  } as TeamworkPlan;
  fs.writeFileSync(
    file,
    JSON.stringify({
      session_id: plan.sessionId,
      batch_id: plan.batchId,
      plan_hash: plan.planHash,
    }),
  );
  recordForegroundWait(root, plan, { planPath: file, taskRoot: task });
  const hook = path.resolve(
    __dirname,
    "../../src/templates/shared-hooks/guard-teamwork-wait.py",
  );
  const invoke = (command: string) => {
    const result = spawnSync("python3", [hook], {
      encoding: "utf8",
      env: { ...process.env, TRELLIS_HOOKS: "1" },
      input: JSON.stringify({
        cwd: root,
        session_id: "owner",
        tool_name: "Bash",
        tool_input: { command },
      }),
    });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout
      ? (JSON.parse(result.stdout).hookSpecificOutput as {
          permissionDecision: string;
          permissionDecisionReason: string;
        })
      : undefined;
  };
  const command = `trellis teamwork reconcile '${file}' --task '${task}'`;
  expect(invoke("echo unrelated")?.permissionDecisionReason).toContain(
    `${command} --wait 30`,
  );
  expect(invoke(`${command} --wait 1`)).toBeUndefined();
  expect(
    invoke(`${command} --execute --reason 'verified exit'`),
  ).toBeUndefined();
  for (const suffix of [
    "--wait 0",
    "--wait 61",
    "--wait 1.5",
    "--wait 1 --execute",
    "--execute",
    "--confirm-unknown-process-exit",
    "--task other",
    "--wait 1; echo bypass",
    "--wait 1 $(echo bypass)",
  ])
    expect(invoke(`${command} ${suffix}`)?.permissionDecision, suffix).toBe(
      "deny",
    );
  const before = fs.readFileSync(file);
  fs.writeFileSync(
    file,
    JSON.stringify({
      session_id: "other",
      batch_id: plan.batchId,
      plan_hash: plan.planHash,
    }),
  );
  expect(invoke(`${command} --wait 1`)?.permissionDecision).toBe("deny");
  fs.writeFileSync(file, before);
  const projection = foregroundWaitFile(root, plan);
  if (!projection) throw new Error("missing test projection");
  fs.writeFileSync(projection, "{}");
  expect(invoke(`${command} --wait 1`)).toBeUndefined();
  expect(
    invoke(`${command} --execute --reason recovery`)?.permissionDecision,
  ).toBe("deny");
  recordForegroundWait(root, plan, { planPath: file, taskRoot: task });
  const alternate = path.join(task, "original.json");
  fs.renameSync(file, alternate);
  fs.symlinkSync(alternate, file);
  expect(invoke(`${command} --wait 1`)?.permissionDecision).toBe("deny");
});
