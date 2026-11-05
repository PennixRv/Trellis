import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { writeFileAtomic } from "../../utils/atomic-write.js";
import type { TeamworkPlan } from "./artifact.js";

/** A host guard projection, never a second scheduler or proof of process exit. */
export function foregroundWaitFile(
  cwd: string,
  plan: TeamworkPlan,
): string | undefined {
  const session = process.env.CODEX_THREAD_ID;
  if (!session) return undefined;
  const digest = (value: string): string =>
    crypto.createHash("sha256").update(value).digest("hex");
  return path.join(
    cwd,
    ".trellis",
    ".runtime",
    "teamwork-waits",
    digest(session),
    `${digest(`${plan.sessionId}:${plan.batchId}`)}.json`,
  );
}

export function recordForegroundWait(cwd: string, plan: TeamworkPlan): void {
  const file = foregroundWaitFile(cwd, plan);
  if (!file) return;
  const relative = path.relative(cwd, path.dirname(file));
  let directory = cwd;
  for (const part of relative.split(path.sep)) {
    directory = path.join(directory, part);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(directory).isSymbolicLink())
      throw new Error("Foreground wait projection must not traverse symlinks");
  }
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
    throw new Error("Invalid foreground wait projection");
  writeFileAtomic(
    file,
    JSON.stringify({
      schemaVersion: 1,
      sessionId: plan.sessionId,
      batchId: plan.batchId,
      planHash: plan.planHash,
      ownerPid: process.pid,
      state: "waiting",
    }),
  );
}

export function clearForegroundWait(cwd: string, plan: TeamworkPlan): void {
  const root = path.join(cwd, ".trellis", ".runtime", "teamwork-waits");
  if (!fs.existsSync(root) || fs.lstatSync(root).isSymbolicLink()) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    for (const name of fs.readdirSync(directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) continue;
      let value: Record<string, unknown>;
      try {
        value = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
          string,
          unknown
        >;
      } catch {
        continue;
      }
      if (
        value.sessionId === plan.sessionId &&
        value.batchId === plan.batchId &&
        value.planHash === plan.planHash
      )
        fs.unlinkSync(file);
    }
  }
}
