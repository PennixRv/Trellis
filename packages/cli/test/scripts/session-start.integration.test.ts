import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const templates = path.resolve(__dirname, "../../src/templates");

describe.each(["shared-hooks", "codex/hooks", "copilot/hooks"])("%s SessionStart safety", (owner) => {
  let repo: string;
  let environment: NodeJS.ProcessEnv;
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-session-start-"));
    environment = { ...process.env, TRELLIS_CONTEXT_ID: "hook-test" };
    for (const key of Object.keys(environment)) {
      if (key.endsWith("_PROJECT_DIR")) Reflect.deleteProperty(environment, key);
    }
    delete environment.TRELLIS_DISABLE_HOOKS;
    delete environment.TRELLIS_HOOKS;
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));
  const hook = path.join(templates, owner, "session-start.py");
  function invoke(input: string, cwd = repo) {
    return spawnSync("python3", [hook], { cwd, input, encoding: "utf-8", env: environment });
  }
  function initialize() {
    fs.mkdirSync(path.join(repo, ".trellis/tasks/task-a"), { recursive: true });
    fs.cpSync(path.join(templates, "trellis/scripts"), path.join(repo, ".trellis/scripts"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".trellis/tasks/task-a/task.json"), JSON.stringify({ id: "task-a", status: "planning" }));
    execFileSync("python3", ["-c", "import sys; from pathlib import Path; sys.path.insert(0, '.trellis/scripts'); from common.active_task import set_active_task; assert set_active_task('.trellis/tasks/task-a', Path.cwd())"], { cwd: repo, env: environment });
  }
  it("returns safely without a project for absent or invalid input", () => {
    for (const input of ["", "{", "[]", JSON.stringify({ cwd: null })]) {
      const result = invoke(input);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe("");
    }
  });
  it("finds the project from a child cwd and projects unreadable task records", () => {
    initialize();
    const child = path.join(repo, "nested");
    fs.mkdirSync(child);
    const good = invoke(JSON.stringify({ cwd: child }), child);
    expect(good.status, good.stderr).toBe(0);
    expect(good.stdout).toContain("Status: PLANNING");
    const taskJson = path.join(repo, ".trellis/tasks/task-a/task.json");
    for (const content of [undefined, "{", "[]", '"string"', "{}", '{"status":null}']) {
      if (content === undefined) fs.unlinkSync(taskJson);
      else fs.writeFileSync(taskJson, content);
      const result = invoke(JSON.stringify({ cwd: child }), child);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("Status: TASK_ERROR");
      expect(result.stdout).toContain("status=task_error");
      expect(result.stdout).not.toContain("Status: UNKNOWN");
    }
  });
});
