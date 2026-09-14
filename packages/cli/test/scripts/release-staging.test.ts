import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RELEASE_SCRIPT = path.resolve(__dirname, "../../scripts/release.js");
const PRE_RELEASE_ADD_PATHS = [
  ".",
  ":!docs-site",
  ":!marketplace",
  ":(exclude,glob).trellis/**",
];

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

describe("release pre-commit staging", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-release-stage-"));
    git(tmp, "init", "-q", "-b", "main");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("does not stage Trellis task artifacts", () => {
    fs.writeFileSync(path.join(tmp, "README.md"), "release change\n");
    const taskDir = path.join(tmp, ".trellis", "tasks", "active-task");
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, "prd.md"), "active task\n");

    expect(fs.readFileSync(RELEASE_SCRIPT, "utf-8")).toContain(
      "git add -A -- . ':!docs-site' ':!marketplace' ':(exclude,glob).trellis/**'",
    );
    git(tmp, "add", "-A", "--", ...PRE_RELEASE_ADD_PATHS);

    expect(git(tmp, "diff", "--cached", "--name-only").split("\n")).toEqual([
      "README.md",
    ]);
  });
});
