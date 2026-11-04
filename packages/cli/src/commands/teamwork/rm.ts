/**
 * `trellis teamwork rm <name>` — stop any live teammates, then remove the
 * Teamwork Session directory under `~/.trellis/teamwork/`.
 *
 * `trellis teamwork prune [--all | --idle <duration> | --empty]` — bulk
 * cleanup matching criteria.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { teamworkSessionKill } from "./kill.js";
import { withLock } from "./store/lock.js";
import { readBatchReservations } from "./batch-reservation.js";

import {
  sessionDir,
  teamworkRoot,
  currentProjectKey,
  eventsPath,
  lockPath,
  listProjects,
  projectDir,
  resolveExistingTeamworkSession,
} from "./store/paths.js";
import {
  GLOBAL_PROJECT_KEY,
  parseTeamworkSessionScope,
} from "./store/schema.js";

export interface RmOptions {
  force?: boolean;
  /** Project bucket override. Defaults to current cwd's project. */
  project?: string;
  scope?: string;
}

export async function teamworkSessionRm(
  name: string,
  opts: RmOptions = {},
): Promise<void> {
  const project =
    opts.project ??
    resolveExistingTeamworkSession(name, {
      scope: parseTeamworkSessionScope(opts.scope),
    }).project;
  const dir = sessionDir(name, project);
  if (!fs.existsSync(dir)) {
    throw new Error(`Teamwork session '${name}' not found at ${dir}`);
  }
  await withLock(
    path.join(projectDir(project), ".worker-guard.lock"),
    async () => {
      if (
        readBatchReservations(projectDir(project)).some(
          (item) => item.sessionId === name,
        )
      )
        throw new Error(
          "Batch capacity reservation is unresolved; session evidence preserved",
        );
      const teammates = new Set(
        fs
          .readdirSync(dir)
          .flatMap((name) =>
            name.endsWith(".worker-pid")
              ? [name.slice(0, -11)]
              : name.endsWith(".pid")
                ? [name.slice(0, -4)]
                : [],
          ),
      );
      for (const teammate of teammates) {
        await teamworkSessionKill(name, { as: teammate, project });
      }
      if (
        fs
          .readdirSync(dir)
          .some((entry) => /\.(spawnlock|reservation|config)$/.test(entry))
      ) {
        throw new Error(
          "Pending teammate launch; session recovery files preserved",
        );
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  );
  if (!opts.force) {
    console.log(`Removed Teamwork session '${name}'`);
  }
}

export interface PruneOptions {
  all?: boolean;
  empty?: boolean;
  idleMs?: number;
  /** Remove only Teamwork Sessions marked `ephemeral: true` in their create event. */
  ephemeral?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  keep?: string[];
  scope?: string;
}

export async function teamworkSessionPrune(opts: PruneOptions): Promise<void> {
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

  const scope = parseTeamworkSessionScope(opts.scope);
  const root = teamworkRoot();
  if (!fs.existsSync(root)) {
    console.log("(no Teamwork sessions)");
    return;
  }

  const keep = new Set(opts.keep ?? []);
  const candidates: {
    name: string;
    project: string;
    reason: string;
    lastTs?: string;
    eventsDigest: string;
  }[] = [];

  const projects =
    scope === "global"
      ? [GLOBAL_PROJECT_KEY]
      : scope === "project"
        ? [currentProjectKey()]
        : listProjects();
  // Unscoped prune stays repo-wide by design; users want to clean across
  // projects with one command.
  for (const project of projects) {
    const dir = projectDir(project);
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue; // skip .bucket marker
      if (keep.has(name)) continue;
      if (readBatchReservations(dir).some((item) => item.sessionId === name))
        continue;
      const chDir = sessionDir(name, project);
      try {
        if (!fs.statSync(chDir).isDirectory()) continue;
      } catch {
        continue;
      }
      // Preserve live, pending, or unreadable runtime evidence.
      if (hasLiveWorker(chDir)) continue;

      const eventsFile = eventsPath(name, project);
      let totalEvents = 0;
      let lastTs: string | undefined;
      let ephemeralFlag = false;
      let eventsDigest: string;
      try {
        const text = fs.readFileSync(eventsFile, "utf-8");
        eventsDigest = createHash("sha256").update(text).digest("hex");
        const lines = text.split("\n").filter((l) => l.trim());
        totalEvents = lines.length;
        const events = lines.map(
          (line) =>
            JSON.parse(line) as { ephemeral?: boolean; ts?: string } | null,
        );
        if (events.some((event) => !event || typeof event !== "object"))
          continue;
        ephemeralFlag = events[0]?.ephemeral === true;
        lastTs = events.at(-1)?.ts;
        if (typeof lastTs !== "string" || Number.isNaN(Date.parse(lastTs)))
          continue;
      } catch {
        continue;
      }

      let reason: string | null = null;
      if (opts.ephemeral) {
        if (ephemeralFlag) reason = "ephemeral";
      } else if (opts.all) {
        reason = "all";
      } else if (opts.empty && totalEvents <= 1) {
        reason = "empty";
      } else if (opts.idleMs !== undefined && lastTs) {
        const age = Date.now() - Date.parse(lastTs);
        if (age >= opts.idleMs) reason = `idle ${Math.round(age / 60_000)}m`;
      }
      if (reason)
        candidates.push({ name, project, reason, lastTs, eventsDigest });
    }
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

  if (opts.dryRun) {
    console.log(
      `\n(dry-run) would remove ${candidates.length} Teamwork session(s)`,
    );
    return;
  }
  if (!opts.yes) {
    console.log(
      `\nRefusing to delete ${candidates.length} Teamwork Session(s) without --yes. ` +
        `Re-run with --yes (or --dry-run to preview).`,
    );
    return;
  }

  let removed = 0;
  for (const c of candidates) {
    try {
      await withLock(
        path.join(projectDir(c.project), ".worker-guard.lock"),
        () =>
          withLock(lockPath(c.name, c.project), () => {
            const directory = sessionDir(c.name, c.project);
            if (
              readBatchReservations(projectDir(c.project)).some(
                (item) => item.sessionId === c.name,
              )
            )
              return;
            if (hasLiveWorker(directory)) return;
            // Do not remove a session that changed after the preview.
            const current = fs.readFileSync(
              eventsPath(c.name, c.project),
              "utf-8",
            );
            if (
              createHash("sha256").update(current).digest("hex") !==
              c.eventsDigest
            )
              return;
            fs.rmSync(directory, { recursive: true, force: true });
            removed++;
          }),
      );
    } catch (err) {
      console.error(
        `  failed to remove ${c.name}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  console.log(`\nRemoved ${removed}/${candidates.length} Teamwork session(s)`);
}

function hasLiveWorker(dir: string): boolean {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (
        f.endsWith(".spawnlock") ||
        f.endsWith(".reservation") ||
        f.endsWith(".config")
      )
        return true;
      if (!f.endsWith(".pid") && !f.endsWith(".worker-pid")) continue;
      const pid = Number(fs.readFileSync(path.join(dir, f), "utf-8").trim());
      if (!Number.isSafeInteger(pid) || pid <= 0 || pidAlive(pid)) return true;
    }
  } catch {
    return true;
  }
  return false;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
