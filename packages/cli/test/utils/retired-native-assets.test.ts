import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertCurrentExecutionAsset,
  assertCurrentExecutionTree,
  executeNativeRetirement,
  planNativeRetirement,
} from "../../src/utils/retired-native-assets.js";
import { computeHash } from "../../src/utils/template-hash.js";
import { collectPlatformTemplates, getInitToolChoices } from "../../src/configurators/index.js";
import { createAssetBackup, bindAssetUpdate, planAssetRestore, restoreAssetBackup } from "../../src/utils/asset-backup.js";

describe("native execution retirement", () => {
  let root: string;
  const role = ".codex/agents/trellis-implement.toml";
  const write = (relative: string, content: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  };
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-retire-")); });
  afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

  it("all platforms generate current assets without native roles or executors", () => {
    const choices = getInitToolChoices();
    expect(choices).toHaveLength(22);
    for (const choice of choices) {
      const templates = collectPlatformTemplates(choice.platformId);
      expect(templates?.size).toBeGreaterThan(0);
      for (const [relative, content] of templates ?? []) {
        expect(() => assertCurrentExecutionAsset(relative, content), `${choice.platformId}: ${relative}`).not.toThrow();
        expect(content).not.toContain("{{EXECUTOR_AI}}");
        expect(content).not.toContain("{{#AGENT_CAPABLE}}");
      }
    }
  });

  it("uses manifest ownership before pruning and is idempotent", () => {
    write(role, "owned role");
    write(".codex/agents/user.toml", "user role");
    const plan = planNativeRetirement(root, { [role]: computeHash("owned role") }, []);
    expect(plan.deletions.map((entry) => entry.path)).toEqual([role]);
    executeNativeRetirement(root, plan);
    expect(fs.readFileSync(path.join(root, ".codex/agents/user.toml"), "utf8")).toBe("user role");
    expect(planNativeRetirement(root, {}, []).deletions).toEqual([]);
    assertCurrentExecutionTree(root);
  });

  it.each(["modified", "unowned", "skip", "symlink"])("blocks %s assets without deleting user data", (kind) => {
    write(role, "owned role");
    const hashes = kind === "unowned" ? {} : { [role]: computeHash("owned role") };
    if (kind === "modified") write(role, "customized");
    if (kind === "symlink") {
      write("user.txt", "user data"); fs.unlinkSync(path.join(root, role));
      fs.symlinkSync(path.join(root, "user.txt"), path.join(root, role));
    }
    expect(() => planNativeRetirement(root, hashes, kind === "skip" ? [".codex"] : [])).toThrow();
    expect(fs.existsSync(path.join(root, role))).toBe(true);
  });

  it("rechecks fingerprints immediately before deletion", () => {
    write(role, "owned role");
    const plan = planNativeRetirement(root, { [role]: computeHash("owned role") }, []);
    write(role, "changed after preview");
    expect(() => executeNativeRetirement(root, plan)).toThrow("changed after preflight");
    expect(fs.readFileSync(path.join(root, role), "utf8")).toBe("changed after preview");
  });

  it("removes only retired registrations and config assignments", () => {
    const hooks = ".codex/hooks.json";
    write(hooks, JSON.stringify({ user: 7, hooks: { SubagentStart: [{ hooks: [{ command: "python .codex/hooks/inject-subagent-context.py" }, { command: "user-hook" }] }] } }));
    write(".trellis/config.yaml", "codex:\n  dispatch_mode: auto\n  user_option: keep\nother: true\n");
    write(".codex/config.toml", "[agents]\nenabled = false\nmax_depth = 1\nuser = true\n[mcp_servers.user]\ncommand = 'user'\n");
    const config = ".codex/config.toml";
    const plan = planNativeRetirement(root, { [config]: computeHash(fs.readFileSync(path.join(root, config), "utf8")) }, []);
    expect(JSON.parse(plan.edits.get(hooks) ?? "{}")).toEqual({ user: 7, hooks: { SubagentStart: [{ hooks: [{ command: "user-hook" }] }] } });
    expect(plan.edits.get(".trellis/config.yaml")).toBe("codex:\n  user_option: keep\nother: true\n");
    expect(plan.edits.get(".codex/config.toml")).toBe("[agents]\nenabled = false\nuser = true\n[mcp_servers.user]\ncommand = 'user'\n");
  });

  it("preserves the ordinary Reasonix check method", () => {
    write(".reasonix/skills/trellis-check/SKILL.md", "---\nname: trellis-check\n---\nCheck the change.");
    expect(planNativeRetirement(root, {}, []).deletions).toEqual([]);
    assertCurrentExecutionTree(root);
  });

  it("preserves an independently configured user agent depth", () => {
    write(".codex/config.toml", "[agents]\nmax_depth = 1\n");
    expect(planNativeRetirement(root, {}, []).edits.size).toBe(0);
    assertCurrentExecutionTree(root);
  });

  it.each([false, true])("rejects retired snapshots before restore writes, replaceModified=%s", (replaceModified) => {
    write(".trellis/workflow.md", "current workflow");
    for (const name of ["task_layout.py", "task_workflow.py"]) write(`.trellis/scripts/common/${name}`, "same task runtime");
    write(role, "retired role");
    vi.stubEnv("TRELLIS_ABLATION_STATE_ROOT", path.join(root, "maintenance-external"));
    const backup = createAssetBackup(root, "update", [role]);
    fs.unlinkSync(path.join(root, role)); bindAssetUpdate(root, backup.id);
    expect(() => planAssetRestore(root, backup.id, replaceModified)).toThrow("Retired native execution asset");
    expect(() => restoreAssetBackup(root, backup.id, { replaceModified, yes: true })).toThrow("Retired native execution asset");
    expect(fs.existsSync(path.join(root, role))).toBe(false);
  });
});
