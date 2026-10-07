import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it("rejects an unpublished submodule before tagging and accepts a published ancestor", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-release-submodule-"));
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf-8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  const init = (cwd: string) => {
    fs.mkdirSync(cwd);
    git(cwd, "init", "-q", "-b", "main");
    git(cwd, "config", "user.email", "test@example.com");
    git(cwd, "config", "user.name", "test");
  };
  try {
    const remote = path.join(tmp, "remote.git");
    const child = path.join(tmp, "child");
    const parent = path.join(tmp, "parent");
    git(tmp, "init", "--bare", "-q", "-b", "main", remote);
    init(child);
    fs.writeFileSync(path.join(child, "file"), "first");
    git(child, "add", "file"); git(child, "commit", "-qm", "first");
    git(child, "remote", "add", "origin", remote); git(child, "push", "-q", "origin", "main");
    init(parent);
    git(parent, "-c", "protocol.file.allow=always", "submodule", "add", "-q", remote, "module");
    git(parent, "commit", "-qam", "module");
    const module = path.join(parent, "module");
    git(module, "config", "protocol.file.allow", "always");
    git(module, "config", "user.email", "test@example.com"); git(module, "config", "user.name", "test");
    fs.writeFileSync(path.join(module, "file"), "unpublished");
    git(module, "commit", "-qam", "unpublished"); git(parent, "commit", "-qam", "new pointer");
    const script = pathToFileURL(path.resolve(__dirname, "../../scripts/release-preflight.js")).href;
    const check = () => spawnSync(process.execPath, ["--input-type=module", "-e", `import {checkSubmodules} from ${JSON.stringify(script)}; checkSubmodules(${JSON.stringify(parent)});`], { encoding: "utf-8" });
    expect(check().status).not.toBe(0);
    expect(git(parent, "tag")).toBe("");
    git(module, "push", "-q", "origin", "main");
    const pinned = git(module, "rev-parse", "HEAD");
    fs.writeFileSync(path.join(module, "file"), "later published commit");
    git(module, "commit", "-qam", "later"); git(module, "push", "-q", "origin", "main");
    git(module, "checkout", "--detach", pinned);
    const result = check();
    expect(result.status, result.stderr).toBe(0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
