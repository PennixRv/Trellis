/**
 * `trellis channel rm <name>` — kill any live workers, then remove the
 * channel directory under `~/.trellis/channels/`.
 *
 * `trellis channel prune [--all | --idle <duration> | --empty]` — bulk
 * cleanup matching criteria.
 */

import fs from "node:fs";
import path from "node:path";

import { isSupervisorProcess } from "./guard.js";
import { readProcessIdentity } from "./process-identity.js";
import { withLock } from "./store/lock.js";
import {
  channelDir,
  channelRoot,
  currentProjectKey,
  eventsPath,
  listProjects,
  migrateLegacyChannels,
  projectDir,
  resolveExistingChannelRef,
} from "./store/paths.js";
import { GLOBAL_PROJECT_KEY, parseChannelScope } from "./store/schema.js";

export interface RmOptions {
  force?: boolean;
  /** Project bucket override. Defaults to current cwd's project. */
  project?: string;
  scope?: string;
}

export async function channelRm(
  name: string,
  opts: RmOptions = {},
): Promise<void> {
  const project =
    opts.project ??
    resolveExistingChannelRef(name, {
      scope: parseChannelScope(opts.scope),
    }).project;
  const dir = channelDir(name, project);
  if (!fs.existsSync(dir)) {
    throw new Error(`Channel '${name}' not found at ${dir}`);
  }
  await killLiveWorkers(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  if (!opts.force) {
    console.log(`Removed channel '${name}'`);
  }
}

export interface PruneOptions {
  all?: boolean;
  empty?: boolean;
  idleMs?: number;
  /** Remove only channels marked `ephemeral: true` in their create event. */
  ephemeral?: boolean;
  yes?: boolean;
  keep?: string[];
  scope?: string;
}

export async function channelPrune(opts: PruneOptions): Promise<void> {
  // The filter flags are mutually exclusive — combining them gives a
  // silently-ignored second filter under the else-if chain below. Catch
  // that up front so the user knows which one would have applied.
  const modes = [
    opts.ephemeral && "--ephemeral",
    opts.all && "--all",
    opts.empty && "--empty",
    opts.idleMs !== undefined && "--idle",
  ].filter(Boolean);
  if (modes.length > 1) {
    throw new Error(
      `prune flags are mutually exclusive: ${modes.join(" / ")}. Pick one.`,
    );
  }

  migrateLegacyChannels();
  const scope = parseChannelScope(opts.scope);
  const root = channelRoot();
  if (!fs.existsSync(root)) {
    console.log("(no channels)");
    return;
  }

  const keep = new Set(opts.keep ?? []);
  const candidates: {
    name: string;
    project: string;
    reason: string;
    lastTs?: string;
  }[] = [];

  const projects =
    scope === "global"
      ? [GLOBAL_PROJECT_KEY]
      : scope === "project"
        ? [currentProjectKey()]
        : listProjects();
  // Unscoped prune stays repo-wide by design; users want to clean across
  // projects with one command. The project guard serializes discovery with
  // spawn admission; deletion rechecks every candidate under that guard.
  for (const project of projects) {
    await withLock(path.join(projectDir(project), ".worker-guard.lock"), () => {
      candidates.push(...findPruneCandidates(project, keep, opts));
    });
  }

  if (candidates.length === 0) {
    console.log("(nothing to prune)");
    return;
  }

  // Show what we're about to do
  for (const c of candidates) {
    const last = c.lastTs ? c.lastTs.slice(0, 19).replace("T", " ") : "-";
    console.log(`  ${c.name.padEnd(24)}  ${last}  (${c.reason})`);
  }

  if (!opts.yes) {
    console.log(`\n(dry-run) would remove ${candidates.length} channel(s)`);
    return;
  }

  let removed = 0;
  let skipped = 0;
  let releasedBytes = 0;
  for (const project of projects) {
    const projectCandidates = candidates.filter(
      (candidate) => candidate.project === project,
    );
    if (projectCandidates.length === 0) continue;
    await withLock(path.join(projectDir(project), ".worker-guard.lock"), () => {
      for (const c of projectCandidates) {
        const current = inspectChannel(c.name, c.project);
        if (current.kind !== "candidate") {
          skipped++;
          console.error(`  skipped ${c.name}: ${current.reason}`);
          continue;
        }
        const bytes = directorySize(channelDir(c.name, c.project));
        try {
          fs.rmSync(channelDir(c.name, c.project), {
            recursive: true,
            force: true,
          });
          removed++;
          releasedBytes += bytes;
        } catch (err) {
          skipped++;
          console.error(
            `  failed to remove ${c.name}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    });
  }
  console.log(
    `\nRemoved ${removed}/${candidates.length} channel(s); skipped ${skipped}; released ${releasedBytes} bytes`,
  );
}

type ChannelInspection =
  | { kind: "candidate"; reason: string; lastTs?: string }
  | { kind: "blocked"; reason: string };

function findPruneCandidates(
  project: string,
  keep: Set<string>,
  opts: PruneOptions,
): PruneCandidate[] {
  const dir = projectDir(project);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const candidates: PruneCandidate[] = [];
  for (const name of entries) {
    if (name.startsWith(".") || keep.has(name)) continue;
    const inspection = inspectChannel(name, project);
    if (inspection.kind !== "candidate") continue;
    if (matchesPruneFilter(inspection, opts)) {
      candidates.push({
        name,
        project,
        reason: inspection.reason,
        lastTs: inspection.lastTs,
      });
    }
  }
  return candidates;
}

interface PruneCandidate {
  name: string;
  project: string;
  reason: string;
  lastTs?: string;
}

function matchesPruneFilter(
  inspection: Extract<ChannelInspection, { kind: "candidate" }>,
  opts: PruneOptions,
): boolean {
  if (opts.ephemeral) return inspection.reason === "ephemeral";
  if (opts.all) return true;
  if (opts.empty) return inspection.reason === "empty";
  if (opts.idleMs !== undefined && inspection.lastTs) {
    return Date.now() - Date.parse(inspection.lastTs) >= opts.idleMs;
  }
  return false;
}

function inspectChannel(name: string, project: string): ChannelInspection {
  const chDir = channelDir(name, project);
  try {
    if (!fs.statSync(chDir).isDirectory())
      return { kind: "blocked", reason: "not a directory" };
  } catch {
    return { kind: "blocked", reason: "channel directory is unreadable" };
  }
  const workerState = inspectWorkers(chDir, name);
  if (workerState) return { kind: "blocked", reason: workerState };

  let lines: string[];
  try {
    lines = fs
      .readFileSync(eventsPath(name, project), "utf-8")
      .split("\n")
      .filter((line) => line.trim());
  } catch {
    return { kind: "blocked", reason: "events.jsonl is missing or unreadable" };
  }
  if (lines.length === 0)
    return { kind: "blocked", reason: "events.jsonl is empty" };
  const parsed: { ts?: unknown; ephemeral?: unknown }[] = [];
  try {
    for (const line of lines) {
      const event = JSON.parse(line) as unknown;
      if (!event || typeof event !== "object")
        throw new Error("event is not an object");
      parsed.push(event as { ts?: unknown; ephemeral?: unknown });
    }
  } catch {
    return { kind: "blocked", reason: "events.jsonl contains invalid JSON" };
  }
  const lastTs = parsed.at(-1)?.ts;
  if (typeof lastTs !== "string" || Number.isNaN(Date.parse(lastTs))) {
    return {
      kind: "blocked",
      reason: "events.jsonl has no valid final timestamp",
    };
  }
  return {
    kind: "candidate",
    reason:
      parsed[0]?.ephemeral === true
        ? "ephemeral"
        : lines.length === 1
          ? "empty"
          : "all",
    lastTs,
  };
}

function inspectWorkers(dir: string, channel: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return "worker state is unreadable";
  }
  for (const entry of entries) {
    if (!entry.endsWith(".pid")) continue;
    const pidPath = path.join(dir, entry);
    let pid: number;
    try {
      pid = Number(fs.readFileSync(pidPath, "utf-8").trim());
    } catch {
      return `cannot read ${entry}`;
    }
    if (!Number.isSafeInteger(pid) || pid <= 0)
      return `invalid PID in ${entry}`;
    if (!pidAlive(pid)) continue;
    const worker = entry.slice(0, -4);
    if (!isSupervisorProcess(pid, channel, worker))
      return `unverified supervisor in ${entry}`;
    const childPidPath = path.join(dir, `${worker}.worker-pid`);
    if (fs.existsSync(childPidPath)) {
      let childPid: number;
      try {
        childPid = Number(fs.readFileSync(childPidPath, "utf-8").trim());
      } catch {
        return `cannot read ${worker}.worker-pid`;
      }
      if (!Number.isSafeInteger(childPid) || childPid <= 0) {
        return `invalid child PID in ${worker}.worker-pid`;
      }
      if (pidAlive(childPid)) {
        const childIdentityPath = path.join(dir, `${worker}.worker-identity`);
        let expected: string;
        try {
          expected = fs.readFileSync(childIdentityPath, "utf-8").trim();
        } catch {
          return `cannot verify ${worker}.worker-pid`;
        }
        if (!expected || readProcessIdentity(childPid) !== expected) {
          return `unverified child identity in ${worker}.worker-pid`;
        }
      }
    }
    return `live supervisor in ${entry}`;
  }
  return null;
}

function directorySize(root: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) total += directorySize(fullPath);
    else if (entry.isFile()) {
      try {
        total += fs.statSync(fullPath).size;
      } catch {
        // The deletion itself will fail closed if the entry changes.
      }
    }
  }
  return total;
}

async function killLiveWorkers(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const f of entries) {
    if (!f.endsWith(".pid")) continue;
    const pid = Number(fs.readFileSync(path.join(dir, f), "utf-8").trim());
    if (pid && pidAlive(pid)) {
      try {
        process.kill(pid, "SIGTERM");
        const deadline = Date.now() + 1500;
        while (pidAlive(pid) && Date.now() < deadline) {
          await sleep(50);
        }
        if (pidAlive(pid)) process.kill(pid, "SIGKILL");
      } catch {
        // already dead
      }
    }
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
