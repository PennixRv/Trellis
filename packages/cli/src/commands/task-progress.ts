import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";

export interface TaskProgress {
  planning: number;
  in_progress: number;
  completed: number;
  cancelled: number;
  partial: boolean;
}

export function getTaskProgress(cwd = process.cwd()): TaskProgress {
  const progress: TaskProgress = {
    planning: 0,
    in_progress: 0,
    completed: 0,
    cancelled: 0,
    partial: false,
  };
  const tasksRoot = path.join(cwd, ".trellis", "tasks");

  if (
    fs.existsSync(
      path.join(cwd, ".trellis/.runtime/task-layout-transaction.json"),
    )
  ) {
    progress.partial = true;
    return progress;
  }

  const readEntries = (directory: string): fs.Dirent[] => {
    try {
      return fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        progress.partial = true;
      return [];
    }
  };
  const names = new Set<string>();
  const countTask = (directory: string, expected: string): void => {
    const name = path.basename(directory);
    if (names.has(name)) progress.partial = true;
    names.add(name);
    try {
      const task: unknown = JSON.parse(
        fs.readFileSync(path.join(directory, "task.json"), "utf8"),
      );
      const status =
        typeof task === "object" && task !== null && !Array.isArray(task)
          ? (task as { status?: unknown }).status
          : undefined;
      if (status !== expected) progress.partial = true;
      if (
        status === "planning" ||
        status === "in_progress" ||
        status === "completed" ||
        status === "cancelled"
      ) {
        progress[status] += 1;
      } else progress.partial = true;
    } catch {
      progress.partial = true;
    }
  };

  for (const status of readEntries(tasksRoot)) {
    if (status.isSymbolicLink()) {
      progress.partial = true;
      continue;
    }
    if (!status.isDirectory()) continue;
    if (
      !["planning", "in_progress", "completed", "cancelled"].includes(
        status.name,
      )
    ) {
      progress.partial = true;
      continue;
    }
    const statusDir = path.join(tasksRoot, status.name);
    for (const entry of readEntries(statusDir)) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        progress.partial = true;
        continue;
      }
      if (status.name === "completed") {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(entry.name)) {
          progress.partial = true;
          continue;
        }
        const monthDir = path.join(statusDir, entry.name);
        for (const task of readEntries(monthDir)) {
          if (task.isDirectory() && !task.isSymbolicLink())
            countTask(path.join(monthDir, task.name), status.name);
          else progress.partial = true;
        }
      } else countTask(path.join(statusDir, entry.name), status.name);
    }
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
    `${progress.planning}:${progress.in_progress}:${progress.completed}:${progress.cancelled}${progress.partial ? "?" : ""}`,
  );
}

export function registerTaskProgressCommand(program: Command): void {
  program
    .command("task")
    .description("Read-only Trellis task status")
    .command("progress")
    .description("Summarize all four Trellis task lifecycle statuses")
    .option("--json", "output machine-readable JSON")
    .action(taskProgress);
}
