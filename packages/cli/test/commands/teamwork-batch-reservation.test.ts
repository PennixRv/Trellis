import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  batchReservationPath,
  readBatchReservations,
  writeBatchReservation,
} from "../../src/commands/teamwork/batch-reservation.js";
import {
  cleanupExpiredIdleWorkers,
  scanLiveWorkers,
} from "../../src/commands/teamwork/guard.js";

describe("durable batch capacity", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-capacity-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("tolerates native settlement removing a reservation during a read", () => {
    writeBatchReservation(root, {
      schemaVersion: 1,
      sessionId: "s",
      batchId: "b",
      planHash: "a".repeat(64),
      capacity: 1,
      ownerPid: process.pid,
    });
    const original = fs.lstatSync;
    vi.spyOn(fs, "lstatSync").mockImplementation(((file: fs.PathLike) => {
      fs.unlinkSync(batchReservationPath(root, "s", "b"));
      return original(file);
    }) as typeof fs.lstatSync);
    expect(readBatchReservations(root)).toEqual([]);
  });

  it("counts unresolved slots after coordinator death and never idle-kills synthetic reservations", async () => {
    const bucket = path.join(root, "project");
    fs.mkdirSync(bucket);
    writeBatchReservation(bucket, {
      schemaVersion: 1,
      sessionId: "s",
      batchId: "b",
      planHash: "a".repeat(64),
      capacity: 2,
      ownerPid: 99999999,
    });
    const live = scanLiveWorkers({ root, projectKey: "project" });
    expect(live).toHaveLength(2);
    expect(await cleanupExpiredIdleWorkers(live, 1)).toEqual({
      killed: [],
      failed: [],
    });
    fs.unlinkSync(batchReservationPath(bucket, "s", "b"));
    expect(scanLiveWorkers({ root, projectKey: "project" })).toEqual([]);
  });

  it("fails closed on corrupt and symlinked reservations", () => {
    const file = batchReservationPath(root, "s", "b");
    fs.writeFileSync(file, "{}");
    expect(() => readBatchReservations(root)).toThrow();
    fs.unlinkSync(file);
    const other = path.join(root, "other");
    fs.writeFileSync(other, "{}");
    fs.symlinkSync(other, file);
    expect(() => readBatchReservations(root)).toThrow(/invalid batch/);
    expect(() => batchReservationPath(root, "../escape", "b")).toThrow(
      /Invalid/,
    );
  });
});
