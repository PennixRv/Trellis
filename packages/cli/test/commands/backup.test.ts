import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BACKUP_COMPLETE_MARKER,
  listBackups,
  pruneBackups,
} from "../../src/commands/backup.js";

describe("update backup retention", () => {
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
    expect(preview.removedNames).toHaveLength(1);
    expect(listBackups(root)).toHaveLength(4);

    const result = pruneBackups(root, { confirm: true });
    expect(result.removedNames).toHaveLength(1);
    expect(listBackups(root)).toHaveLength(3);
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
