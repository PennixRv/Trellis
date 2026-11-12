/**
 * `trellis teamwork rm <name>` previews a settled, unreferenced session;
 * its exact digest confirms removal under `~/.trellis/teamwork/`.
 *
 * `trellis teamwork prune [--all | --idle <duration> | --empty]` — bulk
 * cleanup matching criteria.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readCoordinationState } from "@pennixrv/trellis-core/teamwork";
import { safePath } from "./artifact.js";
import {
  evidenceDigest,
  inspectEvidenceReferences,
} from "./evidence-references.js";
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
  assertSafeName,
  projectKey,
} from "./store/paths.js";
import {
  GLOBAL_PROJECT_KEY,
  parseTeamworkSessionScope,
} from "./store/schema.js";

export interface RmOptions {
  /** Quiet output for the native one-shot caller; never deletion permission. */
  force?: boolean;
  /** Project bucket override. Defaults to current cwd's project. */
  project?: string;
  scope?: string;
  confirm?: string;
}

interface SessionPreview {
  status: "preview" | "removed";
  name: string;
  project: string;
  cwd: string;
  eligible: boolean;
  blockers: string[];
  files: { path: string; fingerprint: unknown[] }[];
  references: ReturnType<typeof inspectEvidenceReferences>;
  digest: string;
}

async function previewSession(
  name: string,
  project: string,
): Promise<SessionPreview> {
  assertSafeName(project, "project bucket");
  const dir = safePath(teamworkRoot(), path.join(project, name));
  const blockers: string[] = [];
  if (
    readBatchReservations(projectDir(project)).some(
      (item) => item.sessionId === name,
    )
  )
    blockers.push(
      "Batch capacity reservation is unresolved; reconcile it first",
    );
  if (hasLiveWorker(dir))
    blockers.push(
      "Live, pending or unverified teammate; use native kill/reconcile independently",
    );
  const entries = fs.readdirSync(dir).sort();
  if (entries.length > 2048)
    throw new Error("Session member inspection limit exceeded");
  let bytes = 0;
  const files: SessionPreview["files"] = [];
  for (const entry of entries) {
    if (entry === `${name}.lock`) continue;
    const file = safePath(dir, entry);
    const info = fs.lstatSync(file);
    if (
      !info.isFile() ||
      !/^(events\.jsonl|\.seq|[A-Za-z0-9._-]+\.(log|pid|worker-pid|worker-identity|inbox-cursor|session-id|thread-id|shutdown-reason|system-prompt\.md))$/.test(
        entry,
      )
    ) {
      blockers.push(`Unknown or nonregular session member: ${entry}`);
      continue;
    }
    bytes += info.size;
    if (bytes > 128 * 1024 * 1024)
      throw new Error("Session byte inspection limit exceeded");
    files.push({
      path: entry,
      fingerprint: [
        info.dev,
        info.ino,
        info.size,
        info.mtimeMs,
        info.ctimeMs,
        createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      ],
    });
  }
  const events = fs
    .readFileSync(eventsPath(name, project), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const created = events[0];
  if (created?.kind !== "create" || typeof created.cwd !== "string")
    throw new Error(
      "Session creation identity is missing or invalid; preserve evidence",
    );
  const cwd = path.resolve(created.cwd);
  if (project !== GLOBAL_PROJECT_KEY && projectKey(cwd) !== project)
    blockers.push("Creation cwd does not match the session project bucket");
  let references: ReturnType<typeof inspectEvidenceReferences>;
  if (
    !fs.existsSync(cwd) ||
    !fs.lstatSync(cwd).isDirectory() ||
    fs.realpathSync(cwd) !== cwd
  ) {
    references = {
      scope: [cwd],
      complete: false,
      protected: [],
      mentions: [],
      issues: ["Owning project is unavailable or redirected"],
    };
  } else {
    references = inspectEvidenceReferences(
      cwd,
      files.map((item) => path.join(dir, item.path)),
      name,
    );
    const projection = await readCoordinationState({
      sessionId: name,
      cwd,
      ...(project === GLOBAL_PROJECT_KEY ? { scope: "global" as const } : {}),
    });
    if (
      projection.issues.length ||
      projection.leases.length ||
      projection.batches.some(
        (batch) =>
          !["ALL_ACCEPTED", "SETTLED_WITH_FAILURE"].includes(batch.state),
      ) ||
      projection.attempts.some((attempt) => !attempt.terminal) ||
      projection.teammates.some((teammate) => !teammate.terminal)
    )
      blockers.push(
        "Coordination evidence still supports review, execution or recovery",
      );
  }
  if (!references.complete) blockers.push(...references.issues);
  blockers.push(
    ...references.protected.map(
      (reference) => `${reference.role}: ${reference.source}`,
    ),
  );
  const value = {
    status: "preview" as const,
    name,
    project,
    cwd,
    eligible: !blockers.length,
    blockers,
    files,
    references,
  };
  return { ...value, digest: evidenceDigest(value) };
}

export async function teamworkSessionRm(
  name: string,
  opts: RmOptions = {},
): Promise<SessionPreview> {
  const project =
    opts.project ??
    resolveExistingTeamworkSession(name, {
      scope: parseTeamworkSessionScope(opts.scope),
    }).project;
  const dir = sessionDir(name, project);
  if (!fs.existsSync(dir)) {
    throw new Error(`Teamwork session '${name}' not found at ${dir}`);
  }
  const result = await withLock(
    path.join(projectDir(project), ".worker-guard.lock"),
    () =>
      withLock(lockPath(name, project), async () => {
        const preview = await previewSession(name, project);
        if (opts.confirm !== undefined) {
          if (opts.confirm !== preview.digest)
            throw new Error(
              "Session cleanup preview changed; inspect a fresh digest",
            );
          if (!preview.eligible)
            throw new Error(
              `Session evidence protected: ${preview.blockers.join("; ")}`,
            );
          fs.rmSync(dir, { recursive: true });
          preview.status = "removed";
        }
        return preview;
      }),
  );
  if (!opts.force) {
    console.log(JSON.stringify(result));
  }
  return result;
}

export interface PruneOptions {
  all?: boolean;
  empty?: boolean;
  idleMs?: number;
  /** Remove only Teamwork Sessions marked `ephemeral: true` in their create event. */
  ephemeral?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  confirm?: string;
  keep?: string[];
  scope?: string;
}

export async function teamworkSessionPrune(
  opts: PruneOptions,
): Promise<
  { digest: string; removed: number; candidates: SessionPreview[] } | undefined
> {
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
    preview: SessionPreview;
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
      const chDir = sessionDir(name, project);
      try {
        if (!fs.statSync(chDir).isDirectory()) continue;
      } catch {
        continue;
      }
      // Preserve live, pending, or unreadable runtime evidence.

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
      if (reason) {
        try {
          const preview = await teamworkSessionRm(name, {
            project,
            force: true,
          });
          candidates.push({
            name,
            project,
            reason,
            lastTs,
            eventsDigest,
            preview,
          });
        } catch (error) {
          console.error(
            `Preserved ${project}/${name}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
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

  const digest = evidenceDigest(candidates.map((item) => item.preview));
  console.log(
    JSON.stringify({
      status: "preview",
      digest,
      candidates: candidates.map((item) => item.preview),
    }),
  );
  if (opts.dryRun || !opts.yes) {
    console.log(
      `\n(dry-run) would remove ${candidates.length} Teamwork session(s)`,
    );
    return {
      digest,
      removed: 0,
      candidates: candidates.map((item) => item.preview),
    };
  }
  if (opts.confirm !== digest)
    throw new Error(
      "Prune requires --yes and the exact current --confirm digest",
    );

  let removed = 0;
  for (const c of candidates) {
    if (!c.preview.eligible) continue;
    try {
      await teamworkSessionRm(c.name, {
        project: c.project,
        force: true,
        confirm: c.preview.digest,
      });
      removed++;
    } catch (err) {
      console.error(
        `  failed to remove ${c.name}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  console.log(`\nRemoved ${removed}/${candidates.length} Teamwork session(s)`);
  return {
    digest,
    removed,
    candidates: candidates.map((item) => item.preview),
  };
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
