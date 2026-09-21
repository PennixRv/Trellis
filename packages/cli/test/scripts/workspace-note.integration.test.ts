/** Integration tests for the non-task `workspace_note.py` helper. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
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

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function setupRepo(tmp: string): void {
  fs.mkdirSync(tmp, { recursive: true });
  git(tmp, "init", "-q", "-b", "main");
  git(tmp, "config", "user.email", "test@example.com");
  git(tmp, "config", "user.name", "Test");
  fs.mkdirSync(path.join(tmp, ".trellis", "scripts"), { recursive: true });
  fs.cpSync(TEMPLATE_SCRIPTS, path.join(tmp, ".trellis", "scripts"), {
    recursive: true,
  });
  const init = spawnSync(
    "python3",
    [".trellis/scripts/init_developer.py", "tester"],
    { cwd: tmp, encoding: "utf-8" },
  );
  if (init.status !== 0) {
    throw new Error(`init_developer failed: ${init.stderr}`);
  }
  git(tmp, "add", "-A");
  git(tmp, "commit", "-q", "-m", "initial");
}

function run(repo: string, ...args: string[]) {
  return spawnSync("python3", [".trellis/scripts/workspace_note.py", ...args], {
    cwd: repo,
    encoding: "utf-8",
  });
}

describe.skipIf(!hasPython())("workspace_note.py", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-workspace-note-test-"));
    setupRepo(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("adds one durable workspace note without mutating task, journal, index, or Git history", () => {
    const workspace = path.join(tmp, ".trellis", "workspace", "tester");
    const journalBefore = fs.readFileSync(path.join(workspace, "journal-1.md"), "utf-8");
    const indexBefore = fs.readFileSync(path.join(workspace, "index.md"), "utf-8");
    const headBefore = git(tmp, "rev-parse", "HEAD");

    const result = run(
      tmp,
      "--kind",
      "decision",
      "--summary",
      "Accepted the evidence after coordinator source recheck.",
      "--source",
      ".trellis/tasks/task-a/subnodes/a/primary/report.json",
    );
    expect(result.status, result.stderr).toBe(0);
    const notes = fs.readFileSync(path.join(workspace, "working-notes.md"), "utf-8");
    expect(notes).toContain("| decision");
    expect(notes).toContain("Accepted the evidence");
    expect(notes).toContain("Sources:");
    expect(fs.readFileSync(path.join(workspace, "journal-1.md"), "utf-8")).toBe(journalBefore);
    expect(fs.readFileSync(path.join(workspace, "index.md"), "utf-8")).toBe(indexBefore);
    expect(git(tmp, "rev-parse", "HEAD")).toBe(headBefore);
    expect(fs.existsSync(path.join(tmp, ".trellis", "tasks"))).toBe(false);
  });

  it("rejects a malformed or credential-bearing note before creating the file", () => {
    const notesPath = path.join(
      tmp,
      ".trellis",
      "workspace",
      "tester",
      "working-notes.md",
    );
    const malformed = run(
      tmp,
      "--kind",
      "decision",
      "--summary",
      "line one\nline two",
    );
    expect(malformed.status).toBe(1);
    expect(fs.existsSync(notesPath)).toBe(false);

    const credential = run(
      tmp,
      "--kind",
      "blocker",
      "--summary",
      "Leaked sk-abcdefghijklmnopqrstuvwx credential.",
    );
    expect(credential.status).toBe(1);
    expect(credential.stderr).toContain("credential");
    expect(fs.existsSync(notesPath)).toBe(false);
  });
});
