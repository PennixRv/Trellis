import fs from "node:fs";
import path from "node:path";

export interface TaskProgress {
  completed: number;
  planned: number;
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
  let completed = 0;
  let partial = false;

  for (const file of files) {
    try {
      const task = JSON.parse(fs.readFileSync(file, "utf8")) as {
        status?: unknown;
      };
      if (task.status === "completed" || task.status === "done") completed += 1;
    } catch {
      partial = true;
    }
  }

  return { completed, planned: files.length, partial };
}

export function taskProgress(options: { json?: boolean } = {}): void {
  const progress = getTaskProgress();
  if (options.json) {
    console.log(JSON.stringify(progress));
    return;
  }
  console.log(`${progress.completed}/${progress.planned}`);
}
