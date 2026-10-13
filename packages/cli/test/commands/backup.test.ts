import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BACKUP_COMPLETE_MARKER,
  BACKUP_PRUNE_LOCK,
  listBackups,
  pruneBackups,
} from "../../src/commands/backup.js";

describe("update backup retention", () => {
  afterEach(() => vi.restoreAllMocks());
  it("previews and removes only completed backups beyond the three-backup floor", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-backup-test-"));
    const workflow = path.join(root, ".trellis");
    fs.mkdirSync(workflow);
    for (let index = 1; index <= 4; index++) {
      const backup = path.join(workflow, `.backup-2026-10-13T00-00-0${index}`);
      fs.mkdirSync(backup);
      fs.writeFileSync(path.join(backup, BACKUP_COMPLETE_MARKER), "test");
      fs.utimesSync(backup, new Date(1_000 * index), new Date(1_000 * index));
    }

    const preview = pruneBackups(root);
    expect(preview.candidateNames).toHaveLength(1);
    expect(preview.removedNames).toHaveLength(0);
    expect(preview.releasedBytes).toBe(0);
    expect(preview.estimatedBytes).toBe(4);
    expect(listBackups(root)).toHaveLength(4);

    const result = pruneBackups(root, { confirm: true });
    expect(result.removedNames).toHaveLength(1);
    expect(result.releasedBytes).toBe(4);
    expect(listBackups(root)).toHaveLength(3);
  });

  it("reports partial failures and releases the shared update lock", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "trellis-backup-failure-"),
    );
    const workflow = path.join(root, ".trellis");
    fs.mkdirSync(workflow);
    for (let index = 1; index <= 5; index++) {
      const backup = path.join(workflow, `.backup-${index}`);
      fs.mkdirSync(backup);
      fs.writeFileSync(path.join(backup, BACKUP_COMPLETE_MARKER), "test");
      fs.utimesSync(backup, new Date(index * 1000), new Date(index * 1000));
    }
    const remove = fs.rmSync.bind(fs);
    vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      if (String(target).endsWith(".backup-2"))
        throw new Error("permission denied");
      remove(target, options);
    });
    const result = pruneBackups(root, { confirm: true });
    expect(result.removedNames).toEqual([".backup-1"]);
    expect(result.failedNames).toEqual([".backup-2"]);
    expect(result.releasedBytes).toBe(4);
    expect(listBackups(root)).toHaveLength(4);
    expect(fs.existsSync(path.join(workflow, BACKUP_PRUNE_LOCK))).toBe(false);
  });

  it("protects an active update and enforces the keep floor", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-backup-lock-"));
    fs.mkdirSync(path.join(root, ".trellis"));
    fs.writeFileSync(path.join(root, ".trellis", BACKUP_PRUNE_LOCK), "");
    expect(pruneBackups(root, { confirm: true }).blockedReason).toMatch(
      /in progress/,
    );
    expect(() => pruneBackups(root, { keep: 2 })).toThrow(/>= 3/);
  });

  it("blocks deletion when an incomplete backup is present", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "trellis-backup-unknown-"),
    );
    const workflow = path.join(root, ".trellis");
    fs.mkdirSync(path.join(workflow, ".backup-incomplete"), {
      recursive: true,
    });

    const result = pruneBackups(root, { confirm: true });
    expect(result.blockedReason).toMatch(/unknown|incomplete/);
    expect(fs.existsSync(path.join(workflow, ".backup-incomplete"))).toBe(true);
  });
});
