import { execFileSync } from "node:child_process";
import path from "node:path";
import { it } from "vitest";

it("preserves task authority and evidence while retiring empty runtime projections", () => {
  execFileSync(
    process.platform === "win32" ? "python" : "python3",
    [path.join(__dirname, "fixtures/task_runtime_test.py")],
    { stdio: "pipe" },
  );
});
