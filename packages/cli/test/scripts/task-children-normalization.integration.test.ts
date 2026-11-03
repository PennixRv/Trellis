/**
 * Integration tests for a non-list `children` field in a parent task.json.
 *
 * `common/task_store.py` reads it with `.get("children", [])`, which returns
 * the default only when the key is *absent*. A parent carrying
 * `"children": null` — older format, or hand-edited — yielded None, and the
 * `not in` test below it raised `TypeError`.
 *
 * The severity was in the ordering: in `create` that raise lands *after* the
 * new task.json is written, leaving a task on disk that its parent does not
 * reference. All three link sites (`create --parent`, `add-subtask`,
 * `remove-subtask`) read the field the same way and are covered here.
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

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function setupRepo(tmp: string): void {
  fs.mkdirSync(path.join(tmp, ".trellis", "scripts"), { recursive: true });
  fs.cpSync(TEMPLATE_SCRIPTS, path.join(tmp, ".trellis", "scripts"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(tmp, ".trellis", "config.yaml"),
    "session_auto_commit: false\n",
  );
  // `task.py create` refuses to run without a developer identity. Write the
  // `.developer` file rather than exporting an env var, so this fixture does
  // not depend on which identity sources the runtime happens to support.
  fs.writeFileSync(path.join(tmp, ".trellis", ".developer"), "name=tester\n");
}

function fixtureDirectory(repo: string, name: string): string {
  const tasks = path.join(repo, ".trellis", "tasks");
  return (
    ["planning", "in_progress", "cancelled", "completed/2026-08"]
      .map((status) => path.join(tasks, status, name))
      .find((directory) => fs.existsSync(directory)) ??
    path.join(tasks, "planning", name)
  );
}

function makeTask(
  repo: string,
  name: string,
  overrides: Record<string, unknown> = {},
): string {
  const status = String(overrides.status ?? "planning");
  const dir =
    status === "completed"
      ? path.join(repo, ".trellis", "tasks", status, "2026-08", name)
      : path.join(repo, ".trellis", "tasks", status, name);
  const existing = fixtureDirectory(repo, name);
  if (existing !== dir && fs.existsSync(existing)) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.renameSync(existing, dir);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "prd.md"), `${name} prd\n`);
  fs.writeFileSync(
    path.join(dir, "task.json"),
    JSON.stringify({
      id: name,
      name,
      title: name,
      status: "planning",
      priority: "P2",
      createdAt: "2026-08-19",
      assignee: "tester",
      creator: "tester",
      subtasks: [],
      children: [],
      parent: null,
      relatedFiles: [],
      meta: {},
      ...overrides,
    }) + "\n",
  );
  return dir;
}

function runTask(repo: string, ...args: string[]) {
  return spawnSync("python3", [".trellis/scripts/task.py", ...args], {
    cwd: repo,
    encoding: "utf-8",
    env: { ...process.env, TRELLIS_DEVELOPER: "tester" },
  });
}

function readChildren(repo: string, name: string): unknown {
  return JSON.parse(
    fs.readFileSync(
      path.join(fixtureDirectory(repo, name), "task.json"),
      "utf-8",
    ),
  ).children;
}

function setChildren(repo: string, name: string, value: unknown): void {
  const file = path.join(fixtureDirectory(repo, name), "task.json");
  const data = JSON.parse(fs.readFileSync(file, "utf-8"));
  data.children = value;
  fs.writeFileSync(file, JSON.stringify(data) + "\n");
}

const PARENT = "08-19-parent";

describe.skipIf(!hasPython())(
  "non-list `children` in a parent task.json",
  () => {
    let tmp: string;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-children-test-"));
      setupRepo(tmp);
      makeTask(tmp, PARENT, { children: null });
    });

    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("`create --parent` links, rather than writing a task the parent never references", () => {
      const r = runTask(
        tmp,
        "create",
        "Child",
        "--description",
        "d",
        "--slug",
        "kid",
        "--parent",
        fixtureDirectory(tmp, PARENT),
        "--no-start",
      );
      expect(r.stderr).not.toContain("TypeError");
      expect(r.status).toBe(0);

      const created = fs
        .readdirSync(path.join(tmp, ".trellis", "tasks", "planning"))
        .filter((d) => d.endsWith("-kid"));
      expect(created).toHaveLength(1);

      // The whole point: the task on disk and the parent's list agree.
      expect(readChildren(tmp, PARENT)).toEqual(created);
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(
              tmp,
              ".trellis",
              "tasks",
              "planning",
              created[0],
              "task.json",
            ),
            "utf-8",
          ),
        ).parent,
      ).toBe(PARENT);
    });

    it.each([
      ["null", null],
      ["a string", "08-19-not-a-list"],
      ["a number", 42],
      ["an object", { "08-19-kid": true }],
    ])("`add-subtask` normalizes %s instead of crashing", (_label, value) => {
      const child = "08-19-standalone";
      makeTask(tmp, child);
      setChildren(tmp, PARENT, value);

      const r = runTask(
        tmp,
        "add-subtask",
        fixtureDirectory(tmp, PARENT),
        fixtureDirectory(tmp, child),
      );
      expect(r.stderr).not.toContain("TypeError");
      expect(r.status).toBe(0);
      expect(readChildren(tmp, PARENT)).toEqual([child]);
    });

    it("`remove-subtask` leaves a valid empty list when the field was null", () => {
      const child = "08-19-standalone";
      makeTask(tmp, child, { parent: PARENT });
      setChildren(tmp, PARENT, null);

      const r = runTask(
        tmp,
        "remove-subtask",
        fixtureDirectory(tmp, PARENT),
        fixtureDirectory(tmp, child),
      );
      expect(r.stderr).not.toContain("TypeError");
      expect(r.status).toBe(0);
      expect(readChildren(tmp, PARENT)).toEqual([]);
    });

    it("allows a cancelled parent to unlink a child recorded as independently continuing", () => {
      const child = "08-19-standalone";
      makeTask(tmp, child, { parent: PARENT });
      makeTask(tmp, PARENT, {
        status: "cancelled",
        children: [child],
        meta: {
          task_workflow: {
            phases: {
              delivery_review_and_closeout: {
                acceptance: { child_dispositions: { [child]: "independent" } },
              },
            },
          },
        },
      });

      const result = runTask(
        tmp,
        "remove-subtask",
        fixtureDirectory(tmp, PARENT),
        fixtureDirectory(tmp, child),
      );

      expect(result.status).toBe(0);
      expect(readChildren(tmp, PARENT)).toEqual([]);
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(fixtureDirectory(tmp, child), "task.json"),
            "utf-8",
          ),
        ).parent,
      ).toBeNull();
    });

    it("does not unlink a child after the parent has completed closeout", () => {
      const child = "08-19-standalone";
      makeTask(tmp, child, { parent: PARENT });
      makeTask(tmp, PARENT, { status: "completed", children: [child] });

      const result = runTask(
        tmp,
        "remove-subtask",
        fixtureDirectory(tmp, PARENT),
        fixtureDirectory(tmp, child),
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("completed parent cannot unlink");
      expect(readChildren(tmp, PARENT)).toEqual([child]);
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(fixtureDirectory(tmp, child), "task.json"),
            "utf-8",
          ),
        ).parent,
      ).toBe(PARENT);
    });
  },
);
