import { execFileSync } from "node:child_process";
import path from "node:path";
import { it } from "vitest";

it("preserves task data and references across status moves, migration and recovery", () => {
  execFileSync(process.platform === "win32" ? "python" : "python3", [
    path.join(__dirname, "fixtures/task_layout_test.py"),
  ], { stdio: "pipe" });
});
