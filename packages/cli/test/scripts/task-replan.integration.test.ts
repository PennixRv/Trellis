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
      JSON.stringify({ id: task, name: task, title: "Replan fixture", status: "in_progress", branch: "pennix/v0.7-beta", meta: { execution_class: "planned", delivery_mode: "change_bearing" }, children: [] }) + "\n",
    );
    for (const name of ["prd.md", "design.md", "implement.md"]) {
      fs.writeFileSync(path.join(repo, ".trellis", "tasks", task, name), "# Approved fixture\n\nBounded test plan.\n");
    }
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

    expect(run(["start", task, "--allow-empty-context"]).status).toBe(1);
    expect(run(["plan", "seal", task]).status).toBe(0);
    expect(run(["plan", "approve", task, "--revision", "2", "--basis", "Explicit test approval after revised plan"]).status).toBe(0);
    const start = run(["start", task, "--allow-empty-context"]);
    expect(start.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(taskPath, "task.json"), "utf-8")).status).toBe("in_progress");
  });

  it("keeps read-only analysis tasks in planning while allowing context selection", () => {
    const directory = path.join(repo, ".trellis", "tasks", "analysis-only");
    fs.mkdirSync(directory);
    const taskJson = path.join(directory, "task.json");
    fs.writeFileSync(
      taskJson,
      JSON.stringify({ id: "analysis-only", name: "analysis-only", status: "planning", branch: null, meta: { execution_class: "direct", delivery_mode: "analysis_only" }, children: [] }) + "\n",
    );
    const before = fs.readFileSync(taskJson, "utf-8");
    const start = run(["start", "analysis-only", "--allow-empty-context"]);
    expect(start.status).toBe(1);
    expect(start.stderr).toContain("analysis_only tasks remain in planning");
    expect(fs.readFileSync(taskJson, "utf-8")).toBe(before);
    expect(run(["select", "analysis-only"]).status).toBe(0);
    expect(fs.readFileSync(taskJson, "utf-8")).toBe(before);
  });

  it("lists replan in the task help output", () => {
    const help = run([]);
    expect(help.status).toBe(1);
    expect(help.stdout).toContain(
      'python3 task.py replan <dir> "<reason>"            Return an in-progress task to planning',
    );
  });

  it("selects planning context without starting, gates current task/revision, and invalidates on replan", () => {
    const directory = path.join(repo, ".trellis", "tasks", task);
    const taskJson = path.join(directory, "task.json");
    const read = () => JSON.parse(fs.readFileSync(taskJson, "utf-8"));
    fs.writeFileSync(taskJson, JSON.stringify({ ...read(), status: "planning", branch: null }) + "\n");
    const before = fs.readFileSync(taskJson, "utf-8");
    expect(run(["select", task]).status).toBe(0);
    expect(fs.readFileSync(taskJson, "utf-8")).toBe(before);
    expect(run(["start", task, "--allow-empty-context"]).status).toBe(1);
    expect(fs.readFileSync(taskJson, "utf-8")).toBe(before);
    expect(run(["plan", "seal", task]).status).toBe(0);
    expect(run(["plan", "approve", task, "--revision", "2", "--basis", "Wrong version"]).status).toBe(1);
    expect(run(["start", task, "--allow-empty-context"]).status).toBe(1);
    expect(run(["plan", "approve", task, "--revision", "1", "--basis", "User explicitly approved final material plan 1"]).status).toBe(0);
    // Progress text is not a new material plan and does not demand reapproval.
    fs.appendFileSync(path.join(directory, "execution.md"), "\nProgress: checks started.\n");
    const approved = read();
    const other = path.join(repo, ".trellis", "tasks", "other-task");
    fs.mkdirSync(other);
    for (const name of ["prd.md", "design.md", "implement.md"]) fs.copyFileSync(path.join(directory, name), path.join(other, name));
    fs.writeFileSync(path.join(other, "task.json"), JSON.stringify({ ...approved, id: "other-task", name: "other-task" }) + "\n");
    expect(run(["start", "other-task", "--allow-empty-context"]).status).toBe(1);
    expect(JSON.parse(run(["current", "--json"]).stdout).current_task.dir).toBe(`.trellis/tasks/${task}`);
    expect(run(["start", task, "--allow-empty-context"]).status).toBe(0);
    expect(run(["replan", task, "Material owner change"]).status).toBe(0);
    expect(read().meta.planning).toEqual({ revision: 2 });
    expect(run(["start", task, "--allow-empty-context"]).status).toBe(1);
    expect(run(["select", "missing-task"]).status).toBe(1);
    fs.mkdirSync(path.join(repo, ".trellis", "tasks", "archive"));
    fs.renameSync(other, path.join(repo, ".trellis", "tasks", "archive", "other-task"));
    expect(run(["select", ".trellis/tasks/archive/other-task"]).status).toBe(1);
  });

  it.each(["prd.md", "design.md", "implement.md"])("rejects changed sealed content in %s before approve or start", (document) => {
    const directory = path.join(repo, ".trellis", "tasks", task);
    const taskJson = path.join(directory, "task.json");
    const data = JSON.parse(fs.readFileSync(taskJson, "utf-8"));
    fs.writeFileSync(taskJson, JSON.stringify({ ...data, status: "planning" }) + "\n");
    expect(run(["plan", "seal", task]).status).toBe(0);
    expect(run(["plan", "approve", task, "--revision", "1", "--basis", "Explicit test approval"]).status).toBe(0);
    const before = fs.readFileSync(taskJson, "utf-8");
    fs.appendFileSync(path.join(directory, document), "\nChanged scope.\n");
    for (const args of [["plan", "approve", task, "--revision", "1", "--basis", "Old approval"], ["start", task, "--allow-empty-context"]]) {
      const result = run(args);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("sealed plan content changed");
      expect(fs.readFileSync(taskJson, "utf-8")).toBe(before);
    }
    expect(run(["plan", "seal", task]).status).toBe(0);
    expect(run(["plan", "approve", task, "--revision", "2", "--basis", "Revised test approval"]).status).toBe(0);
    expect(run(["start", task, "--allow-empty-context"]).status).toBe(0);
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
