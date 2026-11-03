import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RELEASE_SCRIPT = path.resolve(__dirname, "../../scripts/release.js");
const PRE_RELEASE_ADD_PATHS = [
  ".",
  ":!docs-site",
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
      "git add -A -- . ':!docs-site' ':(exclude,glob).trellis/**'",
    );
    git(tmp, "add", "-A", "--", ...PRE_RELEASE_ADD_PATHS);

    expect(git(tmp, "diff", "--cached", "--name-only").split("\n")).toEqual([
      "README.md",
    ]);
  });

  it("requires a manifest for the computed target version before releasing", () => {
    const release = fs.readFileSync(RELEASE_SCRIPT, "utf-8");

    expect(release).toContain("function assertNextVersionManifest(type)");
    expect(release).toContain("Missing target migration manifest");
    expect(release.indexOf("assertNextVersionManifest(type);")).toBeLessThan(
      release.indexOf("node scripts/check-manifest-continuity.js"),
    );
  });

  it("pushes the exact release tag rather than every local tag", () => {
    const release = fs.readFileSync(RELEASE_SCRIPT, "utf-8");

    expect(release).toContain('"refs/tags/v${version}"');
    expect(release).not.toContain('git push origin "HEAD:${branch}" --tags');
  });

  it("publishes to the branch when an existing tag has the same name", () => {
    const remote = path.join(tmp, "remote.git");
    git(tmp, "init", "--bare", "-q", remote);
    git(tmp, "config", "user.email", "test@example.com");
    git(tmp, "config", "user.name", "test");
    fs.writeFileSync(path.join(tmp, "README.md"), "first\n");
    git(tmp, "add", "README.md");
    git(tmp, "commit", "-qm", "first");
    git(tmp, "branch", "-m", "v0.7.1");
    git(tmp, "tag", "v0.7.1");
    git(tmp, "remote", "add", "origin", remote);
    git(tmp, "push", "-q", "origin", "HEAD:refs/heads/v0.7.1", "refs/tags/v0.7.1");
    fs.writeFileSync(path.join(tmp, "README.md"), "release\n");
    git(tmp, "commit", "-qam", "release");
    git(tmp, "tag", "v0.7.1-beta.6");

    const release = fs.readFileSync(RELEASE_SCRIPT, "utf-8");
    const branchQuery = release.match(
      /function currentBranch\(\)\s*\{\s*return output\("([^"]+)"\)/,
    );
    if (!branchQuery) throw new Error("release branch query is missing");
    const branchArgs = branchQuery[1].split(" ").slice(1);
    const branch = git(tmp, ...branchArgs);
    expect(branch).toBe("v0.7.1");
    const command = release.match(/run\(`(git push origin [^`]+)`\);/);
    if (!command) throw new Error("release push command is missing");
    const tokens = command[1]
      .replaceAll("${branch}", branch)
      .replaceAll("${version}", "0.7.1-beta.6")
      .match(/[^\s"]+/g);
    if (!tokens) throw new Error("release push command is empty");
    const [executable, ...args] = tokens;
    const result = spawnSync(executable, args, { cwd: tmp, encoding: "utf-8" });
    expect(result.status, result.stderr).toBe(0);
    const head = git(tmp, "rev-parse", "HEAD");
    expect(git(tmp, "--git-dir", remote, "rev-parse", "refs/heads/v0.7.1")).toBe(head);
    expect(git(tmp, "--git-dir", remote, "rev-parse", "refs/tags/v0.7.1-beta.6")).toBe(head);
  });
});
