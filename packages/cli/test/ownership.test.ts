import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getAllScripts } from "../src/templates/trellis/index.js";

const python = process.platform === "win32" ? "python" : "python3";
const digest = `sha256:${"a".repeat(64)}`;

describe("handoff ownership", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  function fixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-ownership-"));
    roots.push(root);
    for (const [relative, source] of getAllScripts()) {
      const destination = path.join(root, ".trellis", "scripts", relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, source, "utf8");
    }
    const task = path.join(root, ".trellis", "tasks", "demo");
    fs.mkdirSync(task, { recursive: true });
    fs.writeFileSync(path.join(task, "task.json"), JSON.stringify({ id: "demo", title: "Demo", status: "in_progress", children: [] }) + "\n");
    fs.writeFileSync(path.join(task, "prd.md"), "handoff\n");
    fs.mkdirSync(path.join(root, ".trellis", ".runtime", "sessions"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".trellis", ".runtime", "sessions", "codex_source.json"),
      JSON.stringify({ current_task: ".trellis/tasks/demo" }) + "\n",
    );
    spawnSync("git", ["-C", root, "init", "-q"]);
    spawnSync("git", ["-C", root, "config", "user.email", "fixture@example.invalid"]);
    spawnSync("git", ["-C", root, "config", "user.name", "Fixture"]);
    spawnSync("git", ["-C", root, "add", "."]);
    spawnSync("git", ["-C", root, "commit", "-qm", "fixture"]);
    return root;
  }

  function run(root: string, session: string, args: string[]) {
    return spawnSync(
      python,
      [path.join(root, ".trellis", "scripts", "task.py"), "ownership", ...args],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, TRELLIS_CONTEXT_ID: session },
      },
    );
  }

  function base(command: string, expected?: number): string[] {
    return [
      command,
      "--task-id", "demo",
      "--handoff-id", "h1",
      "--core-digest", digest,
      ...(expected === undefined ? [] : ["--expected-generation", String(expected)]),
      "--explicit-user-request",
    ];
  }

  it("retires the source, claims with a new session, fences the source, and archives after consume", () => {
    const root = fixture();
    const quiesce = run(root, "codex_source", [...base("quiesce"), "--task", ".trellis/tasks/demo", "--source-session-id", "codex_source"]);
    expect(quiesce.status, quiesce.stderr + quiesce.stdout).toBe(0);
    expect(JSON.parse(run(root, "codex_source", base("status")).stdout).status).toBe("quiescing");
    expect(run(root, "codex_source", base("seal", 0)).status).toBe(0);
    expect(run(root, "codex_source", [...base("retire", 1), "--archive-observation", "not_required"]).status).toBe(0);

    const beforeClaim = spawnSync(
      python,
      [path.join(root, ".trellis", "scripts", "task.py"), "current", "--json"],
      { cwd: root, encoding: "utf8", env: { ...process.env, TRELLIS_CONTEXT_ID: "codex_target" } },
    );
    expect(JSON.parse(beforeClaim.stdout).current_task).toBeNull();

    const sourceCurrent = spawnSync(
      python,
      [path.join(root, ".trellis", "scripts", "task.py"), "current", "--json"],
      { cwd: root, encoding: "utf8", env: { ...process.env, TRELLIS_CONTEXT_ID: "codex_source" } },
    );
    expect(JSON.parse(sourceCurrent.stdout).current_task).toBeNull();
    const oldStart = spawnSync(
      python,
      [path.join(root, ".trellis", "scripts", "task.py"), "start", ".trellis/tasks/demo", "--allow-empty-context"],
      { cwd: root, encoding: "utf8", env: { ...process.env, TRELLIS_CONTEXT_ID: "codex_source" } },
    );
    expect(oldStart.status).toBe(2);
    expect(oldStart.stderr).toContain("fencing_conflict");

    const claimed = run(root, "codex_target", [...base("claim", 3), "--task", ".trellis/tasks/demo"]);
    expect(claimed.status, claimed.stderr + claimed.stdout).toBe(0);
    expect(JSON.parse(claimed.stdout).status).toBe("claimed");
    expect(run(root, "codex_target", [...base("claim", 3), "--task", ".trellis/tasks/demo"]).status).toBe(0);
    const generation = JSON.parse(claimed.stdout).generation as number;
    expect(run(root, "codex_target", base("consume", generation)).status).toBe(0);
    expect(run(root, "codex_target", base("consume", generation)).status).toBe(0);
    const consumed = JSON.parse(run(root, "codex_target", base("status")).stdout);
    expect(consumed.status).toBe("consumed");
    expect(run(root, "codex_target", base("archive", consumed.generation)).status).toBe(0);
    expect(run(root, "codex_target", base("archive", consumed.generation)).status).toBe(0);
    expect(JSON.parse(run(root, "codex_target", base("status")).stdout).status).toBe("archived");
  });

  it("allows exactly one competing successor and refuses ordinary start before claim", async () => {
    const root = fixture();
    expect(run(root, "codex_source", [...base("quiesce"), "--task", ".trellis/tasks/demo", "--source-session-id", "codex_source"]).status).toBe(0);
    expect(run(root, "codex_source", base("seal", 0)).status).toBe(0);
    expect(run(root, "codex_source", [...base("retire", 1), "--archive-observation", "not_required"]).status).toBe(0);

    const start = spawnSync(
      python,
      [path.join(root, ".trellis", "scripts", "task.py"), "start", ".trellis/tasks/demo", "--allow-empty-context"],
      { cwd: root, encoding: "utf8", env: { ...process.env, TRELLIS_CONTEXT_ID: "codex_other" } },
    );
    expect(start.status).toBe(2);
    expect(start.stderr).toContain("fencing_conflict");

    const args = [...base("claim", 3), "--task", ".trellis/tasks/demo"];
    const results = await Promise.all(["codex_target_a", "codex_target_b"].map((session) => new Promise<number | null>((resolve) => {
      const child = spawn(python, [path.join(root, ".trellis", "scripts", "task.py"), "ownership", ...args], {
        cwd: root,
        env: { ...process.env, TRELLIS_CONTEXT_ID: session },
      });
      child.once("close", resolve);
    })));
    expect(results.sort()).toEqual([0, 2]);
    const records = ["codex_target_a", "codex_target_b"].map((session) => JSON.parse(run(root, session, base("status")).stdout));
    const record = records.find((value) => value.status === "claimed");
    expect(record?.status).toBe("claimed");
    expect(["codex_target_a", "codex_target_b"]).toContain(record?.consumer_session_id);
  });

  it("does not accept a source pointer as target identity and rejects fallback", () => {
    const root = fixture();
    expect(run(root, "codex_source", [...base("quiesce"), "--task", ".trellis/tasks/demo", "--source-session-id", "codex_source"]).status).toBe(0);
    const noIdentity = spawnSync(
      python,
      [path.join(root, ".trellis", "scripts", "task.py"), "ownership", ...base("status")],
      { cwd: root, encoding: "utf8", env: { ...process.env, TRELLIS_CONTEXT_ID: "" } },
    );
    expect(noIdentity.status).toBe(0);
    expect(JSON.parse(noIdentity.stdout).status).toBe("quiescing");
    const current = spawnSync(
      python,
      [path.join(root, ".trellis", "scripts", "task.py"), "current", "--json"],
      { cwd: root, encoding: "utf8", env: { ...process.env, TRELLIS_CONTEXT_ID: "codex_target" } },
    );
    expect(JSON.parse(current.stdout).current_task).toBeNull();
  });
});
