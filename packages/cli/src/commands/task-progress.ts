import fs from "node:fs";
import path from "node:path";

export interface TaskProgress {
  planning: number;
  in_progress: number;
  completed: number;
  partial: boolean;
}

function taskJsonFiles(tasksRoot: string): string[] {
  if (!fs.existsSync(tasksRoot)) return [];

  const files: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(tasksRoot, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "archive") continue;
    const taskFile = path.join(tasksRoot, entry.name, "task.json");
    if (fs.existsSync(taskFile)) files.push(taskFile);
  }
  return files;
}

export function getTaskProgress(cwd = process.cwd()): TaskProgress {
  const tasksRoot = path.join(cwd, ".trellis", "tasks");
  const files = taskJsonFiles(tasksRoot);
  let planning = 0;
  let in_progress = 0;
  let completed = 0;
  let partial = false;

  for (const file of files) {
    try {
      const task = JSON.parse(fs.readFileSync(file, "utf8")) as {
        status?: unknown;
      };
      if (task.status === "planning") planning += 1;
      else if (task.status === "in_progress") in_progress += 1;
      else if (task.status === "completed") completed += 1;
      else partial = true;
    } catch {
      partial = true;
    }
  }

  return { planning, in_progress, completed, partial };
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
