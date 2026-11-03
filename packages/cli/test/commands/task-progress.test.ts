import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getTaskProgress,
  registerTaskProgressCommand,
} from "../../src/commands/task-progress.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function makeProject(): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "trellis-task-progress-"),
  );
  temporaryDirectories.push(directory);
  fs.mkdirSync(path.join(directory, ".trellis", "tasks"), { recursive: true });
  return directory;
}

function writeTask(directory: string, status: string): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "task.json"),
    JSON.stringify({ status }),
  );
}

describe("task progress", () => {
  it("counts all four lifecycle statuses across their prescribed directories", () => {
    const project = makeProject();
    writeTask(
      path.join(project, ".trellis", "tasks", "planning", "planned"),
      "planning",
    );
    writeTask(
      path.join(project, ".trellis", "tasks", "in_progress", "active"),
      "in_progress",
    );
    writeTask(
      path.join(project, ".trellis", "tasks", "cancelled", "withdrawn"),
      "cancelled",
    );
    writeTask(
      path.join(project, ".trellis", "tasks", "completed", "2026-10", "old"),
      "completed",
    );

    expect(getTaskProgress(project)).toEqual({
      planning: 1,
      in_progress: 1,
      completed: 1,
      cancelled: 1,
      partial: false,
    });
  });

  it("marks malformed and unknown task statuses partial without guessing", () => {
    const project = makeProject();
    const malformed = path.join(
      project,
      ".trellis",
      "tasks",
      "planning",
      "malformed",
    );
    fs.mkdirSync(malformed, { recursive: true });
    fs.writeFileSync(path.join(malformed, "task.json"), "{");
    writeTask(
      path.join(project, ".trellis", "tasks", "planning", "unknown"),
      "done",
    );

    expect(getTaskProgress(project)).toEqual({
      planning: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
      partial: true,
    });
  });

  it("marks a task directory without task.json as partial", () => {
    const project = makeProject();
    fs.mkdirSync(
      path.join(project, ".trellis", "tasks", "planning", "incomplete"),
      { recursive: true },
    );

    expect(getTaskProgress(project)).toEqual({
      planning: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
      partial: true,
    });
  });

  it("returns an empty count when the task directory does not exist", () => {
    const project = fs.mkdtempSync(
      path.join(os.tmpdir(), "trellis-task-progress-"),
    );
    temporaryDirectories.push(project);

    expect(getTaskProgress(project)).toEqual({
      planning: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
      partial: false,
    });
  });

  it("registers task progress with compact and JSON output", async () => {
    const project = makeProject();
    writeTask(
      path.join(project, ".trellis", "tasks", "in_progress", "active"),
      "in_progress",
    );
    vi.spyOn(process, "cwd").mockReturnValue(project);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const jsonProgram = new Command();
    registerTaskProgressCommand(jsonProgram);

    await jsonProgram.parseAsync([
      "node",
      "trellis",
      "task",
      "progress",
      "--json",
    ]);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({
      planning: 0,
      in_progress: 1,
      completed: 0,
      cancelled: 0,
      partial: false,
    });

    log.mockClear();
    const textProgram = new Command();
    registerTaskProgressCommand(textProgram);
    await textProgram.parseAsync(["node", "trellis", "task", "progress"]);
    expect(log).toHaveBeenCalledWith("0:1:0:0");
  });

  it("reports legacy layouts and status mismatches as partial", () => {
    const project = makeProject();
    writeTask(
      path.join(project, ".trellis", "tasks", "archive", "2026-10", "old"),
      "completed",
    );
    writeTask(
      path.join(project, ".trellis", "tasks", "planning", "mismatch"),
      "cancelled",
    );
    expect(getTaskProgress(project)).toEqual({
      planning: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 1,
      partial: true,
    });
  });

  it("withholds counts while a layout transaction needs recovery", () => {
    const project = makeProject();
    writeTask(
      path.join(project, ".trellis", "tasks", "in_progress", "active"),
      "in_progress",
    );
    fs.mkdirSync(path.join(project, ".trellis", ".runtime"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(
        project,
        ".trellis",
        ".runtime",
        "task-layout-transaction.json",
      ),
      "{}",
    );
    expect(getTaskProgress(project)).toEqual({
      planning: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
      partial: true,
    });
  });
});
