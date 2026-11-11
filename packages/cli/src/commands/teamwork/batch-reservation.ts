import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { writeFileAtomic } from "../../utils/atomic-write.js";
import { assertSafeName } from "./store/paths.js";

const schema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: z.string().min(1),
    batchId: z.string().min(1),
    planHash: z.string().regex(/^[a-f0-9]{64}$/),
    capacity: z.number().int().min(1).max(32),
    ownerPid: z.number().int().positive(),
  })
  .strict();
export type BatchReservation = z.infer<typeof schema>;

export function batchReservationPath(
  bucket: string,
  sessionId: string,
  batchId: string,
): string {
  assertSafeName(sessionId);
  assertSafeName(batchId, "batch");
  return path.join(bucket, `.${sessionId}.${batchId}.batch-reservation.json`);
}

/** Dead coordinators do not prove that their provider processes stopped. */
export function readBatchReservations(bucket: string): BatchReservation[] {
  if (!fs.existsSync(bucket)) return [];
  return fs
    .readdirSync(bucket)
    .filter((name) => name.endsWith(".batch-reservation.json"))
    .flatMap((name) => {
      const file = path.join(bucket, name);
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
          throw new Error(`invalid batch capacity reservation: ${file}`);
        const value = schema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
        if (
          batchReservationPath(bucket, value.sessionId, value.batchId) !== file
        )
          throw new Error(
            `batch capacity reservation identity mismatch: ${file}`,
          );
        return [value];
      } catch (error) {
        // A settling coordinator may remove its reservation after readdir.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    });
}

export function writeBatchReservation(
  bucket: string,
  reservation: BatchReservation,
): void {
  const value = schema.parse(reservation);
  writeFileAtomic(
    batchReservationPath(bucket, value.sessionId, value.batchId),
    JSON.stringify(value),
  );
}
