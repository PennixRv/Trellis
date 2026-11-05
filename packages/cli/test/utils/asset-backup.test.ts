import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assetBackupScope,
  bindAssetUpdate,
  createAssetBackup,
  listAssetBackups,
  loadAssetBackup,
  planAssetRestore,
  pruneAssetBackups,
  restoreAssetBackup,
  withAssetMaintenance,
} from "../../src/utils/asset-backup.js";
import {
  TRELLIS_BLOCK_START,
  TRELLIS_BLOCK_END,
} from "../../src/utils/managed-paths.js";
import { saveHashes } from "../../src/utils/template-hash.js";
import { registerBackupCommand } from "../../src/commands/backup.js";

describe("asset snapshots", () => {
  let base: string;
  let root: string;
  const workflow = ".trellis/workflow.md";
  const added = ".agents/skills/new/SKILL.md";
  const mixed = (inside: string, outside = "user policy"): string =>
    `${outside}\n${TRELLIS_BLOCK_START}\n${inside}\n${TRELLIS_BLOCK_END}\n`;
  const write = (relative: string, data: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), data);
  };
  const read = (relative: string): string =>
    fs.readFileSync(path.join(root, relative), "utf-8");
  const manifest = (id: string): string =>
    path.join(root, ".trellis", id, "manifest.json");
  const update = (): string => {
    const backup = createAssetBackup(root, "update", [
      workflow,
      added,
      "AGENTS.md",
    ]);
    write(workflow, "new workflow");
    write(added, "new skill");
    write("AGENTS.md", mixed("new managed"));
    bindAssetUpdate(root, backup.id);
    return backup.id;
  };

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-assets-"));
    root = path.join(base, "project");
    write(workflow, "original workflow");
    write("AGENTS.md", mixed("old managed"));
    for (const name of ["task_layout.py", "task_workflow.py"])
      write(`.trellis/scripts/common/${name}`, "fixture task runtime");
    vi.stubEnv("TRELLIS_ABLATION_STATE_ROOT", path.join(base, "maintenance"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it("publishes unique verified private snapshots, with only registered asset paths", () => {
    saveHashes(root, {
      [workflow]: "hash",
      ".trellis/tasks/private/task.json": "hash",
      ".trellis/session-handoffs/secret.json": "hash",
      ".trellis/.env": "hash",
    });
    write(".trellis/unregistered.txt", "unmanaged");
    vi.useFakeTimers();
    try {
      const a = createAssetBackup(root);
      const b = createAssetBackup(root);
      expect(a.id).not.toBe(b.id);
      expect(a.entries.map((entry) => entry.path)).toEqual([
        ".trellis/.template-hashes.json",
        ".trellis/.version",
        workflow,
      ]);
      expect(assetBackupScope(root)).not.toContain(".trellis/unregistered.txt");
      expect(loadAssetBackup(root, a.id)).toEqual(a);
      if (process.platform !== "win32") {
        expect(fs.statSync(path.dirname(manifest(a.id))).mode & 0o777).toBe(
          0o700,
        );
        expect(fs.statSync(manifest(a.id)).mode & 0o777).toBe(0o600);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    "../outside",
    ".trellis/tasks/a/task.json",
    ".trellis/spec/a.md",
    ".trellis/workspace/journal.md",
    ".trellis/session-handoffs/a.json",
    ".trellis/.env",
    "src/a.ts",
  ])("refuses protected or non-asset scope %s", (relative) => {
    expect(() => createAssetBackup(root, "manual", [relative])).toThrow();
    expect(listAssetBackups(root)).toEqual([]);
  });

  it.each([".github/copilot-instructions.md", ".snow/SNOW.md"])(
    "includes and restores the managed single-file asset %s",
    (relative) => {
      write(relative, "original instructions");
      saveHashes(root, { [relative]: "hash" });
      expect(assetBackupScope(root)).toContain(relative);
      const backup = createAssetBackup(root, "update", [relative]);
      write(relative, "updated instructions");
      bindAssetUpdate(root, backup.id);
      const plan = planAssetRestore(root, backup.id);
      restoreAssetBackup(root, backup.id, { yes: true, review: plan.review });
      expect(read(relative)).toBe("original instructions");
    },
  );

  it("rejects corrupt payloads, unknown schemas, foreign identity, and scope tampering", () => {
    const backup = createAssetBackup(root, "manual", [workflow]);
    const file = manifest(backup.id);
    for (const changed of [
      { ...backup, schema: 99 },
      { ...backup, projectKey: "0".repeat(64) },
      {
        ...backup,
        entries: [{ path: "../outside", before: { kind: "absent" } }],
      },
    ]) {
      fs.writeFileSync(file, JSON.stringify(changed));
      expect(() => loadAssetBackup(root, backup.id)).toThrow();
      expect(pruneAssetBackups(root, { all: true, yes: true }).deleted).toEqual(
        [],
      );
    }
    fs.writeFileSync(file, JSON.stringify(backup));
    fs.writeFileSync(
      path.join(path.dirname(file), "files", workflow),
      "damaged",
    );
    expect(() => loadAssetBackup(root, backup.id)).toThrow(/integrity/);
  });

  it("refuses symlink sources and storage without following them", () => {
    if (process.platform === "win32") return;
    write(".trellis/external", "keep");
    fs.symlinkSync("external", path.join(root, ".trellis/link"));
    expect(() => createAssetBackup(root, "manual", [".trellis/link"])).toThrow(
      /Symlink/,
    );
    fs.symlinkSync(root, path.join(root, ".trellis/.backup-unknown"));
    const result = pruneAssetBackups(root, {
      all: true,
      includeLegacy: true,
      yes: true,
    });
    expect(result.deleted).toEqual([]);
    expect(result.protected[0]?.problem).toMatch(/Symlink/);
    expect(read(".trellis/external")).toBe("keep");
  });

  it("previews and restores update assets, deletes new files, and preserves user AGENTS text", () => {
    const id = update();
    write("AGENTS.md", mixed("new managed", "new user policy"));
    const plan = planAssetRestore(root, id);
    expect(plan.entries.every((entry) => entry.action !== "conflict")).toBe(
      true,
    );
    expect(read(workflow)).toBe("new workflow");
    restoreAssetBackup(root, id, { yes: true, review: plan.review });
    expect(read(workflow)).toBe("original workflow");
    expect(fs.existsSync(path.join(root, added))).toBe(false);
    expect(read("AGENTS.md")).toBe(mixed("old managed", "new user policy"));
    expect(loadAssetBackup(root, id).restore?.status).toBe("complete");
    expect(
      listAssetBackups(root).filter((item) => item.kind === "complete"),
    ).toHaveLength(2);
  });

  it("binds explicit modified-file replacement to the latest preview and saves recovery", () => {
    const id = update();
    write(workflow, "user edit");
    const conflict = planAssetRestore(root, id);
    expect(
      conflict.entries.find((entry) => entry.path === workflow)?.action,
    ).toBe("conflict");
    expect(() =>
      restoreAssetBackup(root, id, { yes: true, review: conflict.review }),
    ).toThrow(/conflicts/);
    const plan = planAssetRestore(root, id, true);
    write(workflow, "new user edit");
    expect(() =>
      restoreAssetBackup(root, id, {
        yes: true,
        replaceModified: true,
        review: plan.review,
      }),
    ).toThrow(/preview/);
    const latest = planAssetRestore(root, id, true);
    restoreAssetBackup(root, id, {
      yes: true,
      replaceModified: true,
      review: latest.review,
    });
    const recovery = loadAssetBackup(root, id).restore?.recovery;
    expect(recovery).toBeDefined();
    expect(
      fs.readFileSync(
        path.join(root, ".trellis", recovery ?? "", "files", workflow),
        "utf-8",
      ),
    ).toBe("new user edit");
  });

  it("refuses task runtime rollback even with replace-modified", () => {
    const id = update();
    write(".trellis/scripts/common/task_layout.py", "different task layout");
    expect(() => planAssetRestore(root, id, true)).toThrow(
      /runtime compatibility/,
    );
    expect(read(workflow)).toBe("new workflow");
  });

  it("protects pending updates and interrupted restores, including their recovery snapshots", () => {
    const id = update();
    const plan = planAssetRestore(root, id);
    const unlink = fs.unlinkSync.bind(fs);
    vi.spyOn(fs, "unlinkSync").mockImplementation((target) => {
      if (target === path.join(root, added))
        throw new Error("simulated disk failure");
      return unlink(target);
    });
    expect(() =>
      restoreAssetBackup(root, id, { yes: true, review: plan.review }),
    ).toThrow(/disk failure/);
    const recovery = loadAssetBackup(root, id).restore?.recovery;
    const prune = pruneAssetBackups(root, {
      all: true,
      includeLegacy: true,
      yes: true,
    });
    expect(prune.deleted).toEqual([]);
    expect(prune.protected.map((item) => item.id)).toEqual(
      expect.arrayContaining([id, recovery]),
    );
    expect(() => withAssetMaintenance(root, () => undefined)).toThrow(
      /Unresolved/,
    );
    vi.restoreAllMocks();
    const resume = planAssetRestore(root, id);
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const cli = new Command();
    registerBackupCommand(cli);
    cli.parse([
      "node",
      "trellis",
      "backup",
      "restore",
      id,
      "--yes",
      "--review",
      resume.review,
    ]);
    expect(error).not.toHaveBeenCalled();
    expect(loadAssetBackup(root, id).restore?.status).toBe("complete");
    expect(read(workflow)).toBe("original workflow");
    expect(fs.existsSync(path.join(root, added))).toBe(false);
    const pending = createAssetBackup(root, "update", [workflow]);
    expect(
      listAssetBackups(root).find((item) => item.id === pending.id)?.kind,
    ).toBe("protected");
  });

  it("does not replace new edits after restore interruption", () => {
    const id = update();
    const plan = planAssetRestore(root, id);
    vi.spyOn(fs, "unlinkSync").mockImplementation(() => {
      throw new Error("disk failure");
    });
    expect(() =>
      restoreAssetBackup(root, id, { yes: true, review: plan.review }),
    ).toThrow();
    vi.restoreAllMocks();
    write(workflow, "post-interruption edit");
    expect(
      planAssetRestore(root, id, true).entries.find(
        (entry) => entry.path === workflow,
      )?.action,
    ).toBe("conflict");
  });

  it("keeps three by default, distinguishes legacy sidecars, and permits explicit full cleanup", () => {
    for (let i = 0; i < 5; i++) createAssetBackup(root, "manual", [workflow]);
    const legacy = ".trellis/.backup-2026-11-01T01-02-03/.trellis/config.yaml";
    write(legacy, "legacy asset");
    saveHashes(root, { [workflow]: "hash" });
    write(`${workflow}.backup`, "migration backup");
    write(".trellis/.backup-unknown/unknown", "do not delete");
    const preview = pruneAssetBackups(root);
    expect(preview.selected).toHaveLength(2);
    expect(preview.deleted).toEqual([]);
    expect(() => pruneAssetBackups(root, { keep: 2 })).toThrow(
      /at least three/,
    );
    expect(() => pruneAssetBackups(root, { includeLegacy: true })).toThrow(
      /--all/,
    );
    const daily = pruneAssetBackups(root, { yes: true });
    expect(daily.deleted).toHaveLength(2);
    const all = pruneAssetBackups(root, {
      all: true,
      includeLegacy: true,
      yes: true,
    });
    expect(all.deleted).toHaveLength(5);
    expect(all.failed).toEqual([]);
    expect(read(".trellis/.backup-unknown/unknown")).toBe("do not delete");
  });

  it("recognizes actual old writer roots and version markers without trusting unknown content", () => {
    const legacy = ".trellis/.backup-2026-11-01T01-02-03";
    write(`${legacy}/.trellis/config.yaml`, "legacy asset");
    write(`${legacy}/.codex/config.toml`, "legacy Codex config");
    write(`${legacy}/.agents/skills/trellis-start/SKILL.md`, "legacy Skill");
    write(`${legacy}/.backup-complete`, "0.7.0-beta.52");
    expect(listAssetBackups(root)[0].kind).toBe("legacy");
    expect(
      pruneAssetBackups(root, { all: true, includeLegacy: true }).selected,
    ).toHaveLength(1);
    write(`${legacy}/.backup-complete`, "unknown marker");
    expect(listAssetBackups(root)[0].kind).toBe("protected");
    write(`${legacy}/.backup-complete`, "0.7.0-beta.52");
    write(`${legacy}/user-data/private.txt`, "unknown owner");
    expect(listAssetBackups(root)[0].kind).toBe("protected");
  });

  it("keeps native backup JSON parseable when the CLI and project versions differ", () => {
    write(".trellis/.version", "0.0.1");
    const output = execFileSync(
      process.execPath,
      [path.resolve("dist/cli/index.js"), "backup", "list"],
      { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(JSON.parse(output)).toEqual([]);
  });

  it("reports partial cleanup failures and preserves failed objects", () => {
    const a = createAssetBackup(root, "manual", [workflow]);
    const b = createAssetBackup(root, "manual", [workflow]);
    const rm = fs.rmSync.bind(fs);
    vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      if (target === path.dirname(manifest(a.id)))
        throw new Error("permission denied");
      return rm(target, options);
    });
    const report = pruneAssetBackups(root, { all: true, yes: true });
    expect(report.failed).toEqual([
      { path: `.trellis/${a.id}`, error: "permission denied" },
    ]);
    expect(report.deleted).toEqual([`.trellis/${b.id}`]);
    expect(fs.existsSync(manifest(a.id))).toBe(true);
  });

  it("retains symlink and directory sidecars without hiding valid cleanup candidates", () => {
    saveHashes(root, { [workflow]: "hash", ".trellis/config.yaml": "hash" });
    fs.symlinkSync(
      path.join(root, workflow),
      path.join(root, `${workflow}.backup`),
    );
    fs.mkdirSync(path.join(root, ".trellis/config.yaml.backup"));
    createAssetBackup(root, "manual", [workflow]);
    const result = pruneAssetBackups(root, {
      all: true,
      includeLegacy: true,
      yes: true,
    });
    expect(result.deleted).toHaveLength(1);
    expect(result.protected.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        `${workflow}.backup`,
        ".trellis/config.yaml.backup",
      ]),
    );
    expect(read(workflow)).toBe("original workflow");
  });
});
