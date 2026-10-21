import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const TEMPLATE_SCRIPTS = path.resolve(__dirname, "../../src/templates/trellis/scripts");
const taskDirs = ["10-21-legacy-one", "10-21-legacy-two"];
const sha256 = (content: Buffer | string) => createHash("sha256").update(content).digest("hex");

function hasPython() {
  try { return spawnSync("python3", ["--version"]).status === 0; } catch { return false; }
}

describe.skipIf(!hasPython())("task.py plan migrate", () => {
  let repo: string;
  let originals: Buffer[];

  const taskJson = (directory: string) => path.join(repo, ".trellis", "tasks", directory, "task.json");
  const run = (args: string[]) => spawnSync("python3", [".trellis/scripts/task.py", ...args], { cwd: repo, encoding: "utf-8" });

  function writeManifest() {
    const tasks = taskDirs.map((directory) => {
      const taskPath = `.trellis/tasks/${directory}`;
      return {
        path: taskPath,
        source_digests: {
          "task.json": sha256(fs.readFileSync(taskJson(directory))),
          "prd.md": sha256(fs.readFileSync(path.join(repo, taskPath, "prd.md"))),
        },
        target: { execution_class: "planned", delivery_mode: "change_bearing", stage: null },
      };
    });
    fs.writeFileSync(path.join(repo, ".trellis/migration.json"), JSON.stringify({ schema_version: 1, tasks }));
    return ".trellis/migration.json";
  }

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-task-migration-"));
    fs.mkdirSync(path.join(repo, ".trellis", "tasks"), { recursive: true });
    fs.cpSync(TEMPLATE_SCRIPTS, path.join(repo, ".trellis", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".trellis", ".developer"), "name=tester\n");
    originals = taskDirs.map((directory, index) => {
      const taskDir = path.join(repo, ".trellis", "tasks", directory);
      fs.mkdirSync(taskDir);
      const task = { id: `legacy-${index + 1}`, name: directory, title: `Legacy ${index + 1}`, status: "in_progress", assignee: "tester", branch: "main", meta: { retained: `value-${index + 1}` } };
      const bytes = Buffer.from(`${JSON.stringify(task, null, 2)}\n`);
      fs.writeFileSync(path.join(taskDir, "task.json"), bytes);
      fs.writeFileSync(path.join(taskDir, "prd.md"), `# Legacy ${index + 1}\n`);
      return bytes;
    });
  });

  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("previews, applies, and rolls back with exact task.json preservation", () => {
    const manifest = writeManifest();
    const dryRun = run(["plan", "migrate", "--manifest", manifest]);
    expect(dryRun.status, dryRun.stderr).toBe(0);
    expect(JSON.parse(dryRun.stdout).mode).toBe("dry_run");
    expect(taskDirs.map((directory) => fs.readFileSync(taskJson(directory)))).toEqual(originals);

    const applied = run(["plan", "migrate", "--manifest", manifest, "--apply", "--receipt", ".trellis/receipt.json"]);
    expect(applied.status, applied.stderr).toBe(0);
    for (const directory of taskDirs) {
      const task = JSON.parse(fs.readFileSync(taskJson(directory), "utf-8"));
      expect(task.meta).toMatchObject({ retained: expect.any(String), execution_class: "planned", delivery_mode: "change_bearing", planning: { revision: 1 } });
      expect(task.status).toBe("in_progress");
    }

    const rolledBack = run(["plan", "migrate", "--rollback", ".trellis/receipt.json"]);
    expect(rolledBack.status, rolledBack.stderr).toBe(0);
    expect(taskDirs.map((directory) => fs.readFileSync(taskJson(directory)))).toEqual(originals);
  });

  it("rejects stale source digests before any write", () => {
    const manifest = writeManifest();
    fs.appendFileSync(path.join(repo, ".trellis", "tasks", taskDirs[1], "prd.md"), "Changed after capture.\n");
    const result = run(["plan", "migrate", "--manifest", manifest, "--apply", "--receipt", ".trellis/receipt.json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("source digest changed");
    expect(taskDirs.map((directory) => fs.readFileSync(taskJson(directory)))).toEqual(originals);
  });

  it("rejects malformed task paths before any write", () => {
    const manifest = writeManifest();
    const manifestPath = path.join(repo, manifest);
    const content = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    content.tasks[0].path = null;
    fs.writeFileSync(manifestPath, JSON.stringify(content));

    const result = run(["plan", "migrate", "--manifest", manifest, "--apply", "--receipt", ".trellis/receipt.json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("manifest task path must be a string");
    expect(taskDirs.map((directory) => fs.readFileSync(taskJson(directory)))).toEqual(originals);
  });

  it("restores prior tasks if an apply write fails midway", () => {
    const manifest = writeManifest();
    const script = [
      "import sys",
      "from pathlib import Path",
      "sys.path.insert(0, '.trellis/scripts')",
      "import common.task_migration as m",
      "real = m._write",
      "count = 0",
      "def fail_second(path, raw):",
      "    global count",
      "    count += 1",
      "    if count == 2: raise m.MigrationError('injected write failure')",
      "    real(path, raw)",
      "m._write = fail_second",
      `try: m.migrate(Path('.'), Path(${JSON.stringify(manifest)}), apply=True, receipt_value='.trellis/receipt.json')`,
      "except m.MigrationError as exc:",
      "    print(exc)",
      "    assert count == 3, count",
      "else: raise AssertionError('migration should fail')",
    ].join("\n");
    const result = spawnSync("python3", ["-c", script], { cwd: repo, encoding: "utf-8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("injected write failure");
    expect(taskDirs.map((directory) => fs.readFileSync(taskJson(directory)))).toEqual(originals);
    expect(fs.existsSync(path.join(repo, ".trellis/receipt.json"))).toBe(false);
  });

  it("refuses rollback after a task changes", () => {
    const manifest = writeManifest();
    expect(run(["plan", "migrate", "--manifest", manifest, "--apply", "--receipt", ".trellis/receipt.json"]).status).toBe(0);
    fs.appendFileSync(taskJson(taskDirs[0]), " ");
    const changed = fs.readFileSync(taskJson(taskDirs[0]));
    const result = run(["plan", "migrate", "--rollback", ".trellis/receipt.json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("changed since migration");
    expect(fs.readFileSync(taskJson(taskDirs[0]))).toEqual(changed);
    expect(JSON.parse(fs.readFileSync(taskJson(taskDirs[1]), "utf-8")).meta.planning).toEqual({ revision: 1 });
  });
});
