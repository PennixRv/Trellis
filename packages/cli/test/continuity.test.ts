import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getAllScripts } from "../src/templates/trellis/index.js";

const python = process.platform === "win32" ? "python" : "python3";

describe("task continuity", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  function fixture(withPointer = true): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-continuity-"));
    roots.push(root);
    for (const [relative, source] of getAllScripts()) {
      const destination = path.join(root, ".trellis", "scripts", relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, source, "utf8");
    }
    const task = path.join(root, ".trellis", "tasks", "demo");
    fs.mkdirSync(task, { recursive: true });
    fs.writeFileSync(path.join(task, "task.json"), JSON.stringify({ id: "demo", title: "Demo", status: "in_progress", children: [] }) + "\n");
    fs.writeFileSync(path.join(task, "prd.md"), "fixture\n");
    fs.writeFileSync(path.join(root, "evidence.md"), "verified\n");
    if (withPointer) {
      const sessions = path.join(root, ".trellis", ".runtime", "sessions");
      fs.mkdirSync(sessions, { recursive: true });
      fs.writeFileSync(path.join(sessions, "codex_target.json"), JSON.stringify({ current_task: ".trellis/tasks/demo" }) + "\n");
    }
    execFileSync("git", ["-C", root, "init", "-q"]);
    execFileSync("git", ["-C", root, "config", "user.email", "fixture@example.invalid"]);
    execFileSync("git", ["-C", root, "config", "user.name", "Fixture"]);
    execFileSync("git", ["-C", root, "add", "."]);
    execFileSync("git", ["-C", root, "commit", "-qm", "fixture"]);
    return root;
  }

  function run(root: string, args: string[], withoutContext = false) {
    const env = { ...process.env, TRELLIS_CONTEXT_ID: "codex_target" };
    if (withoutContext) {
      delete env.TRELLIS_CONTEXT_ID;
      delete env.CODEX_THREAD_ID;
    }
    return spawnSync(python, [path.join(root, ".trellis", "scripts", "task.py"), "continuity", ...args], {
      cwd: root,
      encoding: "utf8",
      env,
    });
  }

  function runAsync(root: string, args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(python, [path.join(root, ".trellis", "scripts", "task.py"), "continuity", ...args], {
        cwd: root,
        env: { ...process.env, TRELLIS_CONTEXT_ID: "codex_target" },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.once("error", reject);
      child.once("close", (status) => resolve({ status, stdout, stderr }));
    });
  }

  it("seals, detects source drift, honors CAS, and clears only the current record", () => {
    const root = fixture();
    const request = path.join(root, "continuity-request.json");
    fs.writeFileSync(request, JSON.stringify({
      objective: "Keep the handoff bounded.", decisions: ["Use the CR only as a projection."],
      completed: [], open_items: ["Continue after explicit authorization."], blockers: [],
      next_safe_action: "Reconcile the task.", non_transferable_operations: [], evidence: ["evidence.md"],
    }) + "\n");

    expect(JSON.parse(run(root, ["status", "--json"]).stdout).status).toBe("absent");
    const current = spawnSync(python, [path.join(root, ".trellis", "scripts", "task.py"), "current", "--json"], {
      cwd: root, encoding: "utf8", env: { ...process.env, TRELLIS_CONTEXT_ID: "codex_target" },
    });
    expect(JSON.parse(current.stdout).source).toBe("session:codex_target");
    const sealed = run(root, ["seal", "--request", "continuity-request.json", "--expected", "absent", "--explicit-user-request"]);
    expect(sealed.status, sealed.stderr + sealed.stdout).toBe(0);
    const digest = JSON.parse(sealed.stdout).record_digest as string;
    const ready = JSON.parse(run(root, ["status", "--json"]).stdout);
    expect(ready.status).toBe("ready");
    expect(ready.content.objective).toBe("Keep the handoff bounded.");
    expect(run(root, ["seal", "--request", "continuity-request.json", "--expected", "absent", "--explicit-user-request"]).status).toBe(2);

    fs.writeFileSync(path.join(root, "evidence.md"), "changed\n");
    expect(JSON.parse(run(root, ["status", "--json"]).stdout).status).toBe("stale");
    expect(run(root, ["seal", "--request", "continuity-request.json", "--expected", digest, "--explicit-user-request"]).status).toBe(2);
    expect(run(root, ["clear", "--expected", digest, "--explicit-user-request"]).status).toBe(0);
    expect(JSON.parse(run(root, ["status", "--json"]).stdout).status).toBe("absent");
  });

  it("never turns a sole foreign session pointer into a current CR", () => {
    const root = fixture(false);
    const sessions = path.join(root, ".trellis", ".runtime", "sessions");
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(path.join(sessions, "codex_source.json"), JSON.stringify({ current_task: ".trellis/tasks/demo" }) + "\n");
    const result = JSON.parse(run(root, ["status", "--json"]).stdout);
    expect(result).toMatchObject({ status: "absent", reason: "no_direct_current_task" });
  });

  it("withholds a single-session fallback instead of treating it as a target binding", () => {
    const root = fixture();
    const result = JSON.parse(run(root, ["status", "--json"], true).stdout);
    expect(result).toMatchObject({ status: "withheld", reason: "session_fallback_untrusted" });
  });

  it("serializes simultaneous seals and rejects a symlinked request path", async () => {
    const root = fixture();
    const request = path.join(root, "continuity-request.json");
    fs.writeFileSync(request, JSON.stringify({
      objective: "Keep one winner.", decisions: [], completed: [], open_items: [], blockers: [],
      next_safe_action: "Wait for explicit authorization.", non_transferable_operations: [], evidence: ["evidence.md"],
    }) + "\n");
    const args = ["seal", "--request", "continuity-request.json", "--expected", "absent", "--explicit-user-request"];
    const results = await Promise.all([runAsync(root, args), runAsync(root, args)]);
    expect(results.map((result) => result.status).sort()).toEqual([0, 2]);

    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-continuity-outside-"));
    try {
      const outside = path.join(outsideDir, "request.json");
      fs.writeFileSync(outside, fs.readFileSync(request));
      fs.symlinkSync(outside, path.join(root, "request-link.json"));
      const rejected = run(root, ["seal", "--request", "request-link.json", "--expected", "absent", "--explicit-user-request"]);
      expect(rejected.status).toBe(2);
      expect(JSON.parse(rejected.stdout)).toMatchObject({ status: "withheld" });
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
