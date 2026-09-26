import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEMPLATE_SCRIPTS = path.resolve(__dirname, "../../src/templates/trellis/scripts");
const SHELL_CONTEXT_HOOK = path.resolve(
  __dirname,
  "../../src/templates/shared-hooks/inject-shell-session-context.py",
);

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasPython())("task.py replan lifecycle", () => {
  let repo: string;
  const task = "09-22-replan-fixture";

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-replan-"));
    fs.mkdirSync(path.join(repo, ".trellis", "tasks", task), { recursive: true });
    fs.cpSync(TEMPLATE_SCRIPTS, path.join(repo, ".trellis", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".trellis", ".developer"), "name=tester\n");
    fs.writeFileSync(
      path.join(repo, ".trellis", "tasks", task, "task.json"),
      JSON.stringify({ id: task, name: task, title: "Replan fixture", status: "in_progress", branch: "pennix/v0.7-beta", meta: {}, children: [] }) + "\n",
    );
    execFileSync("git", ["init", "-q", repo]);
  });

  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  function run(args: string[], withIdentity = true) {
    return spawnSync("python3", [".trellis/scripts/task.py", ...args], {
      cwd: repo,
      encoding: "utf-8",
      env: withIdentity
        ? { ...process.env, TRELLIS_CONTEXT_ID: "replan-test" }
        : { ...process.env, TRELLIS_CONTEXT_ID: undefined },
    });
  }

  it("records the reason, returns to planning, and can start again", () => {
    const replan = run(["replan", task, "implementation", "needs", "a", "design", "decision"]);
    expect(replan.status, replan.stderr).toBe(0);

    const taskPath = path.join(repo, ".trellis", "tasks", task);
    expect(JSON.parse(fs.readFileSync(path.join(taskPath, "task.json"), "utf-8")).status).toBe("planning");
    const event = JSON.parse(fs.readFileSync(path.join(taskPath, "replans.jsonl"), "utf-8"));
    expect(event.reason).toBe("implementation needs a design decision");
    expect(event.from_status).toBe("in_progress");
    expect(JSON.parse(fs.readFileSync(path.join(taskPath, "task.json"), "utf-8")).branch).toBe("pennix/v0.7-beta");

    const start = run(["start", task, "--allow-empty-context"]);
    expect(start.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(taskPath, "task.json"), "utf-8")).status).toBe("in_progress");
  });

  it("lists replan in the task help output", () => {
    const help = run([]);
    expect(help.status).toBe(1);
    expect(help.stdout).toContain(
      'python3 task.py replan <dir> "<reason>"            Return an in-progress task to planning',
    );
  });

  it("rejects invalid preconditions without changing task state", () => {
    const taskPath = path.join(repo, ".trellis", "tasks", task);
    for (const args of [
      ["replan", "missing-task", "reason"],
      ["replan", task, "   "],
    ]) {
      expect(run(args).status).toBe(1);
      expect(JSON.parse(fs.readFileSync(path.join(taskPath, "task.json"), "utf-8")).status).toBe("in_progress");
      expect(fs.existsSync(path.join(taskPath, "replans.jsonl"))).toBe(false);
    }

    fs.writeFileSync(
      path.join(taskPath, "task.json"),
      JSON.stringify({ id: task, name: task, status: "planning", meta: {}, children: [] }) + "\n",
    );
    expect(run(["replan", task, "reason"]).status).toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(taskPath, "task.json"), "utf-8")).status).toBe("planning");
    expect(fs.existsSync(path.join(taskPath, "replans.jsonl"))).toBe(false);
  });

  it("does not change task state when the replan event cannot be written", () => {
    const taskPath = path.join(repo, ".trellis", "tasks", task);
    fs.mkdirSync(path.join(taskPath, "replans.jsonl"));
    expect(run(["replan", task, "reason"]).status).toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(taskPath, "task.json"), "utf-8")).status).toBe("in_progress");
  });

  it("uses the shell-session ticket when replan has no native environment identity", () => {
    const hookDirectory = path.join(repo, ".cursor", "hooks");
    fs.mkdirSync(hookDirectory, { recursive: true });
    const hook = path.join(hookDirectory, "inject-shell-session-context.py");
    fs.copyFileSync(SHELL_CONTEXT_HOOK, hook);
    const ticket = spawnSync("python3", [hook], {
      cwd: repo,
      encoding: "utf-8",
      input: JSON.stringify({
        conversation_id: "replan-ticket",
        cwd: repo,
        command: `.trellis/scripts/task.py replan ${task} decision-needed`,
      }),
    });
    expect(ticket.status, ticket.stderr).toBe(0);

    const replan = run(["replan", task, "decision-needed"], false);
    expect(replan.status, replan.stderr).toBe(0);
    const event = JSON.parse(
      fs.readFileSync(path.join(repo, ".trellis", "tasks", task, "replans.jsonl"), "utf-8"),
    );
    expect(event.session).toBeTruthy();
  });
});
