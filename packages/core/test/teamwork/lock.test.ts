import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquireLock,
  releaseLock,
} from "../../src/teamwork/internal/store/lock.js";

describe("Teamwork advisory lock recovery", () => {
  let directory: string;
  let lockFile: string;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-lock-"));
    lockFile = path.join(directory, "events.lock");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it.each(["", "not-a-pid", "0", "-1", "1.5", "9007199254740992"])(
    "preserves an unverified holder %j, including the create-before-write window",
    async (content) => {
      fs.writeFileSync(lockFile, content);
      const kill = vi.spyOn(process, "kill");
      await expect(acquireLock(lockFile, { maxWaitMs: 0 })).rejects.toThrow(
        "Failed to acquire lock",
      );
      expect(fs.readFileSync(lockFile, "utf-8")).toBe(content);
      expect(kill).not.toHaveBeenCalled();
    },
  );

  it.each(["EPERM", "EACCES"])(
    "preserves a holder when liveness probing returns %s",
    async (code) => {
      fs.writeFileSync(lockFile, "12345");
      vi.spyOn(process, "kill").mockImplementation(() => {
        throw Object.assign(new Error("Cannot inspect holder"), { code });
      });
      await expect(acquireLock(lockFile, { maxWaitMs: 0 })).rejects.toThrow(
        "Failed to acquire lock",
      );
      expect(fs.readFileSync(lockFile, "utf-8")).toBe("12345");
    },
  );

  it("serializes competing stale recovery before another holder can replace the lock", async () => {
    fs.writeFileSync(lockFile, "12345");
    const dead = Object.assign(new Error("No such process"), { code: "ESRCH" });
    let contender: Promise<void> | undefined;
    vi.spyOn(process, "kill")
      .mockImplementationOnce(() => {
        contender = acquireLock(lockFile, { maxWaitMs: 0 });
        throw dead;
      })
      .mockImplementation(() => {
        throw dead;
      });
    await acquireLock(lockFile, { maxWaitMs: 0 });
    await expect(contender).rejects.toThrow("Failed to acquire lock");
    expect(fs.readFileSync(lockFile, "utf-8")).toBe(String(process.pid));
    expect(fs.existsSync(`${lockFile}.recovery`)).toBe(false);
  });

  it("preserves an interrupted recovery for explicit inspection", async () => {
    fs.writeFileSync(lockFile, "12345");
    fs.writeFileSync(`${lockFile}.recovery`, "");
    await expect(acquireLock(lockFile, { maxWaitMs: 0 })).rejects.toThrow(
      "Failed to acquire lock",
    );
    expect(fs.readFileSync(lockFile, "utf-8")).toBe("12345");
    expect(fs.existsSync(`${lockFile}.recovery`)).toBe(true);
  });

  it("recovers a verified dead holder and releases its own replacement", async () => {
    fs.writeFileSync(lockFile, "12345");
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("No such process"), { code: "ESRCH" });
    });
    await acquireLock(lockFile, { maxWaitMs: 0 });
    expect(fs.readFileSync(lockFile, "utf-8")).toBe(String(process.pid));
    releaseLock(lockFile);
    expect(fs.existsSync(lockFile)).toBe(false);
  });
});
