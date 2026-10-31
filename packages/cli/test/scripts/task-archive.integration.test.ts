import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
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

describe.skipIf(!hasPython())("task lifecycle commands", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-task-cli-test-"));
    const scriptsDest = path.join(tmp, ".trellis", "scripts");
    fs.mkdirSync(scriptsDest, { recursive: true });
    fs.cpSync(TEMPLATE_SCRIPTS, scriptsDest, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("does not expose the removed archive command", () => {
    const result = spawnSync(
      "python3",
      [".trellis/scripts/task.py", "archive", "old-task"],
      { cwd: tmp, encoding: "utf-8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("invalid choice: 'archive'");
  });
});
