import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";

export interface TaskProgress {
  planning: number;
  in_progress: number;
  completed: number;
  partial: boolean;
}

export function getTaskProgress(cwd = process.cwd()): TaskProgress {
  const progress: TaskProgress = {
    planning: 0,
    in_progress: 0,
    completed: 0,
    partial: false,
  };
  const tasksRoot = path.join(cwd, ".trellis", "tasks");

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(tasksRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      progress.partial = true;
    return progress;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "archive") continue;
    const taskFile = path.join(tasksRoot, entry.name, "task.json");
    let task: unknown;
    try {
      task = JSON.parse(fs.readFileSync(taskFile, "utf8"));
    } catch {
      progress.partial = true;
      continue;
    }

    const status =
      typeof task === "object" && task !== null && !Array.isArray(task)
        ? (task as { status?: unknown }).status
        : undefined;
    if (status === "planning") progress.planning += 1;
    else if (status === "in_progress") progress.in_progress += 1;
    else if (status === "completed") progress.completed += 1;
    else progress.partial = true;
  }

  return progress;
}

export function taskProgress(options: { json?: boolean } = {}): void {
  const progress = getTaskProgress();
  if (options.json) {
    console.log(JSON.stringify(progress));
    return;
  }
  console.log(
    `${progress.planning}:${progress.in_progress}:${progress.completed}${progress.partial ? "?" : ""}`,
  );
}

export function registerTaskProgressCommand(program: Command): void {
  program
    .command("task")
    .description("Read-only Trellis task status")
    .command("progress")
    .description("Summarize active Trellis task lifecycle statuses")
    .option("--json", "output machine-readable JSON")
    .action(taskProgress);
}
