/**
 * Regression tests for #567: a `.trellis` directory that is a symlink into a
 * shared store outside the repo must keep working.
 *
 * 0.6.15 enforced path containment with physical paths only
 * (`Path.resolve()` / `os.path.realpath()` against the repo root), so every
 * ref through the symlinked workflow dir resolved outside the repo and was
 * refused: `task start` failed with "Task not found" and the subagent hook
 * exited silently. The fix keeps the physical check but adds the workflow
 * dir's own real location as a second containment base, and maps accepted
 * refs back to their in-repo (lexical) form for storage.
 *
 * The escapes the containment closed must STAY closed in this layout:
 * `..` traversal, absolute paths elsewhere, and a task dir symlinked out of
 * the tasks tree are still refused.
 */

/**
 * Regression tests for #567: a `.trellis` directory that is a symlink into a
 * shared store outside the repo must keep working.
 *
 * 0.6.15 enforced path containment with physical paths only
 * (`Path.resolve()` / `os.path.realpath()` against the repo root), so every
 * ref through the symlinked workflow dir resolved outside the repo and was
 * refused: `task start` failed with "Task not found" and the subagent hook
 * exited silently. The fix keeps the physical check but adds the workflow
 * dir's own real location as a second containment base, and maps accepted
 * refs back to their in-repo (lexical) form for storage.
 *
 * The escapes the containment closed must STAY closed in this layout:
 * `..` traversal, absolute paths elsewhere, and a task dir symlinked out of
 * the tasks tree are still refused.
 */
/**
 * Regression tests for #567: a `.trellis` directory that is a symlink into a
 * shared store outside the repo must keep working.
 *
 * 0.6.15 enforced path containment with physical paths only
 * (`Path.resolve()` / `os.path.realpath()` against the repo root), so every
 * ref through the symlinked workflow dir resolved outside the repo and was
 * refused: `task start` failed with "Task not found" and the subagent hook
 * exited silently. The fix keeps the physical check but adds the workflow
 * dir's own real location as a second containment base, and maps accepted
 * refs back to their in-repo (lexical) form for storage.
 *
 * The escapes the containment closed must STAY closed in this layout:
 * `..` traversal, absolute paths elsewhere, and a task dir symlinked out of
 * the tasks tree are still refused.
 */
/**
 * Regression tests for #567: a `.trellis` directory that is a symlink into a
 * shared store outside the repo must keep working.
 *
 * 0.6.15 enforced path containment with physical paths only
 * (`Path.resolve()` / `os.path.realpath()` against the repo root), so every
 * ref through the symlinked workflow dir resolved outside the repo and was
 * refused: `task start` failed with "Task not found" and the subagent hook
 * exited silently. The fix keeps the physical check but adds the workflow
 * dir's own real location as a second containment base, and maps accepted
 * refs back to their in-repo (lexical) form for storage.
 *
 * The escapes the containment closed must STAY closed in this layout:
 * `..` traversal, absolute paths elsewhere, and a task dir symlinked out of
 * the tasks tree are still refused.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEMPLATE_SCRIPTS = path.resolve(
  __dirname,
  "../../src/templates/trellis/scripts",
);

const TASK = "08-21-demo";

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runTask(
  repo: string,
  ...args: string[]
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(
    "python3",
    [path.join(".trellis", "scripts", "task.py"), ...args],
    {
      cwd: repo,
      encoding: "utf-8",
      env: { ...process.env, TRELLIS_CONTEXT_ID: "test-ctx" },
    },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe.skipIf(!hasPython() || process.platform === "win32")(
  "symlinked .trellis workflow dir (#567)",
  () => {
    let base: string;
    let store: string; // the real .trellis, outside the repo
    let repo: string; // the git worktree; repo/.trellis -> store

    beforeEach(() => {
      base = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-567-"));
      store = path.join(base, "shared", ".trellis");
      repo = path.join(base, "repo");

      fs.mkdirSync(path.join(store, "tasks", "in_progress", TASK), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(store, "tasks", "in_progress", TASK, "task.json"),
        JSON.stringify({
          id: TASK,
          name: TASK,
          title: TASK,
          status: "in_progress",
          meta: {},
          children: [],
        }) + "\n",
      );
      fs.cpSync(TEMPLATE_SCRIPTS, path.join(store, "scripts"), {
        recursive: true,
      });
      fs.writeFileSync(path.join(store, ".developer"), "name=tester\n");

      fs.mkdirSync(repo, { recursive: true });
      spawnSync("git", ["init", "-q", repo], { encoding: "utf-8" });
      fs.symlinkSync(store, path.join(repo, ".trellis"), "dir");
    });

    afterEach(() => {
      fs.rmSync(base, { recursive: true, force: true });
    });

    it("task.py start resolves a task by name and stores the in-repo ref", () => {
      const r = runTask(repo, "start", TASK);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(
        `Current task set to: .trellis/tasks/in_progress/${TASK}`,
      );
    });

    it("task.py start resolves the path form too", () => {
      const r = runTask(repo, "start", `.trellis/tasks/in_progress/${TASK}`);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(
        `Current task set to: .trellis/tasks/in_progress/${TASK}`,
      );
    });

    it("still refuses `..` traversal in the symlinked layout", () => {
      const r = runTask(repo, "set-meta", "../escape", "pwned", "yes");
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/refusing to use|[Ss]ymlink/);
    });

    it("still refuses a task dir symlinked out of the tasks tree", () => {
      const outside = path.join(base, "outside-target");
      fs.mkdirSync(outside, { recursive: true });
      fs.writeFileSync(
        path.join(outside, "task.json"),
        JSON.stringify({ id: "outside", meta: {} }),
      );
      fs.symlinkSync(
        outside,
        path.join(store, "tasks", "in_progress", "evil"),
        "dir",
      );

      const r = runTask(repo, "set-meta", "evil", "pwned", "yes");
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/refusing to use|[Ss]ymlink/);
      expect(
        JSON.parse(fs.readFileSync(path.join(outside, "task.json"), "utf-8"))
          .meta,
      ).toEqual({});
    });
  },
);
