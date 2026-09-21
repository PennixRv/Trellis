import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { getTaskProgress } from "../../src/commands/task-progress.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeProject(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-task-progress-"));
  temporaryDirectories.push(directory);
  fs.mkdirSync(path.join(directory, ".trellis", "tasks", "archive", "2026-09"), {
    recursive: true,
  });
  return directory;
}

function writeTask(directory: string, status: string): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "task.json"), JSON.stringify({ status }));
}

const CLI_BIN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../bin/trellis.js",
);

describe("task progress", () => {
  it("counts active tasks by lifecycle status", () => {
    const project = makeProject();
    writeTask(path.join(project, ".trellis", "tasks", "active"), "in_progress");
    writeTask(path.join(project, ".trellis", "tasks", "done"), "completed");
    writeTask(
      path.join(project, ".trellis", "tasks", "archive", "2026-09", "old"),
      "completed",
    );

    expect(getTaskProgress(project)).toEqual({
      planning: 0,
      in_progress: 1,
      completed: 1,
      partial: false,
    });
  });

  it("marks malformed and unknown task records partial without inventing a status", () => {
    const project = makeProject();
    const taskDirectory = path.join(project, ".trellis", "tasks", "broken");
    fs.mkdirSync(taskDirectory, { recursive: true });
    fs.writeFileSync(path.join(taskDirectory, "task.json"), "{");

    expect(getTaskProgress(project)).toEqual({
      planning: 0,
      in_progress: 0,
      completed: 0,
      partial: true,
    });
  });

  it("does not treat the legacy done status as completed", () => {
    const project = makeProject();
    writeTask(path.join(project, ".trellis", "tasks", "legacy"), "done");

    expect(getTaskProgress(project)).toEqual({
      planning: 0,
      in_progress: 0,
      completed: 0,
      partial: true,
    });
  });

  it("keeps JSON stdout parseable when the project version is behind", () => {
    const project = makeProject();
    fs.writeFileSync(path.join(project, ".trellis", ".version"), "0.6.14\n");
    writeTask(path.join(project, ".trellis", "tasks", "active"), "in_progress");

    const result = spawnSync(process.execPath, [CLI_BIN, "task", "progress", "--json"], {
      cwd: project,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      planning: 0,
      in_progress: 1,
      completed: 0,
      partial: false,
    });
    expect(result.stderr).toContain("Trellis update available");
  });

  it("renders the compact lifecycle order and partial marker", () => {
    const project = makeProject();
    writeTask(path.join(project, ".trellis", "tasks", "planning"), "planning");
    writeTask(path.join(project, ".trellis", "tasks", "working"), "in_progress");
    writeTask(path.join(project, ".trellis", "tasks", "done"), "completed");
    writeTask(path.join(project, ".trellis", "tasks", "unknown"), "blocked");

    const result = spawnSync(process.execPath, [CLI_BIN, "task", "progress"], {
      cwd: project,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("1:1:1?");
  });
});
