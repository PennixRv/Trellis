import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTransactionPaths,
  withAblationProjectLock,
} from "../../src/utils/ablation-store.js";
import { withAssetMaintenance } from "../../src/utils/asset-backup.js";

describe("shared project maintenance lock", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-maintenance-"));
    fs.mkdirSync(path.join(root, "project"));
    vi.stubEnv("TRELLIS_ABLATION_STATE_ROOT", path.join(root, "state"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(["", "not-json", "0", "{}", '{"pid":1}'])(
    "preserves unknown locks: %j",
    (content) => {
      const paths = getTransactionPaths(path.join(root, "project"));
      fs.mkdirSync(paths.stateRoot, { recursive: true });
      fs.writeFileSync(paths.lockFile, content);
      expect(() => withAblationProjectLock(paths, () => undefined)).toThrow(
        /Unknown/,
      );
      expect(fs.readFileSync(paths.lockFile, "utf-8")).toBe(content);
    },
  );

  it("retains the lock across async work, blocks other entry points, and releases on rejection", async () => {
    const project = path.join(root, "project");
    const paths = getTransactionPaths(project);
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const task = withAssetMaintenance(project, async () => {
      await gate;
      throw new Error("operation failed");
    });
    expect(fs.existsSync(paths.lockFile)).toBe(true);
    expect(() => withAblationProjectLock(paths, () => undefined)).toThrow(
      /in progress/,
    );
    expect(withAssetMaintenance(project, () => "preview", true)).toBe(
      "preview",
    );
    finish?.();
    await expect(task).rejects.toThrow(/operation failed/);
    expect(fs.existsSync(paths.lockFile)).toBe(false);
    expect(withAblationProjectLock(paths, () => "acquired")).toBe("acquired");
  });

  it("does not release a replacement lock, even when its pid is unchanged", () => {
    const paths = getTransactionPaths(path.join(root, "project"));
    withAblationProjectLock(paths, () => {
      fs.writeFileSync(
        paths.lockFile,
        JSON.stringify({ pid: process.pid, nonce: "replacement" }),
      );
    });
    expect(JSON.parse(fs.readFileSync(paths.lockFile, "utf-8"))).toMatchObject({
      nonce: "replacement",
    });
  });
});
