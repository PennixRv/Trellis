import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  GLOBAL_PROJECT_KEY,
  type TeamworkSessionRef,
  type TeamworkSessionScope,
} from "./schema.js";

/** Top-level Trellis Teamwork directory. */
export function teamworkRoot(): string {
  const env = process.env.TRELLIS_TEAMWORK_ROOT;
  if (env && env.length > 0) return path.resolve(env);
  return path.join(os.homedir(), ".trellis", "teamwork");
}

/**
 * Derive a per-project bucket name from an absolute cwd, mirroring
 * Claude Code's `~/.claude/projects/<sanitized-cwd>/` convention so
 * users who already work with that layout get a familiar mental model.
 *
 * The transform is irreversible (multiple cwds can collide if they
 * differ only in `/` vs `_` positions) but the collision risk in
 * practice is negligible — Claude Code accepts the same trade-off.
 */
export function projectKey(cwd: string): string {
  const abs = path.resolve(cwd);
  // Match claude's rule: replace `/`, `_`, `\` with `-`. The leading
  // `-` (from the leading `/` on POSIX paths) is kept so you can spot
  // project buckets at a glance — they always start with `-`.
  //
  // We then sanitise any remaining non-portable bytes (spaces, CJK,
  // `#`, `:` etc.) to `-` as well so the bucket dir name is portable
  // and shell-safe. Modern fs APIs handle exotic chars, but anything
  // that needs quoting in a path is a foot-gun across shells / CI.
  const slashes = abs.replace(/[\\/_]/g, "-");
  return slashes.replace(/[^A-Za-z0-9.-]/g, "-");
}

/**
 * Project key for the current CLI invocation. Reads
 * `TRELLIS_TEAMWORK_PROJECT` env first (set by the supervisor spawn so
 * detached children land in the same bucket as the spawning CLI), then
 * falls back to deriving from `process.cwd()`.
 */
export function currentProjectKey(): string {
  const env = process.env.TRELLIS_TEAMWORK_PROJECT;
  if (env && env.length > 0) return env;
  return projectKey(process.cwd());
}

/** Directory holding Teamwork Sessions for a given project. */
export function projectDir(project: string = currentProjectKey()): string {
  return path.join(teamworkRoot(), project);
}

/** Marker file identifying a project bucket. New buckets create it on first use. */
const BUCKET_MARKER = ".bucket";

/** Characters allowed in a Teamwork Session or teammate name used as a path segment. */
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Whether a Teamwork Session or teammate name is usable as a filesystem segment.
 * Discovery scans use this to skip directories created before name
 * validation existed (spaces, CJK, ...) — they can never be valid
 * valid Teamwork Sessions, and `assertSafeName` throwing mid-scan would kill the scan.
 */
export function isSafeName(name: string): boolean {
  return name !== "." && name !== ".." && SAFE_SEGMENT_RE.test(name);
}

/**
 * Reject names that would escape their bucket when joined into a path.
 * A Teamwork Session ID or worker name becomes a filesystem segment; without this guard
 * a name like `../../x` lets `path.join` resolve outside the store and a
 * later `fs.rmSync(recursive)` deletes arbitrary directories.
 */
export function assertSafeName(name: string, kind = "Teamwork Session"): void {
  if (!isSafeName(name)) {
    throw new Error(
      `Invalid ${kind} name: ${JSON.stringify(name)}. ` +
        `Names may only contain letters, digits, '.', '_' and '-'.`,
    );
  }
}

/**
 * Teamwork Session directory inside its project bucket. Defaults to the current
 * project (cwd-derived); pass an explicit project for cross-project
 * addressing.
 */
export function sessionDir(
  name: string,
  project: string = currentProjectKey(),
): string {
  assertSafeName(name);
  return path.join(projectDir(project), name);
}

export function eventsPath(
  name: string,
  project: string = currentProjectKey(),
): string {
  return path.join(sessionDir(name, project), "events.jsonl");
}

export function lockPath(
  name: string,
  project: string = currentProjectKey(),
): string {
  return path.join(sessionDir(name, project), `${name}.lock`);
}

export function workerFile(
  name: string,
  worker: string,
  suffix: string,
  project: string = currentProjectKey(),
): string {
  assertSafeName(worker, "worker");
  return path.join(sessionDir(name, project), `${worker}.${suffix}`);
}

export function workerLockPath(
  name: string,
  worker: string,
  project: string = currentProjectKey(),
): string {
  assertSafeName(worker, "worker");
  return path.join(sessionDir(name, project), `${worker}.spawnlock`);
}

export function ensureBucketMarker(project: string): void {
  const dir = projectDir(project);
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(dir, BUCKET_MARKER);
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(marker, "");
  }
}

/** Enumerate all project buckets currently on disk. */
export function listProjects(): string[] {
  const root = teamworkRoot();
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root)) {
    const dir = path.join(root, entry);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    // A directory is a project bucket if it has the marker or is global.
    if (
      fs.existsSync(path.join(dir, BUCKET_MARKER)) ||
      entry === GLOBAL_PROJECT_KEY
    ) {
      out.push(entry);
    }
  }
  return out;
}

export interface ResolveTeamworkSessionOptions {
  scope?: TeamworkSessionScope;
  cwd?: string;
}

export function resolveTeamworkSessionProjectForCreate(
  name: string,
  opts: ResolveTeamworkSessionOptions = {},
): TeamworkSessionRef {
  const scope = opts.scope ?? "project";
  const project =
    scope === "global"
      ? GLOBAL_PROJECT_KEY
      : opts.cwd
        ? projectKey(opts.cwd)
        : currentProjectKey();
  return {
    name,
    scope,
    project,
    dir: sessionDir(name, project),
  };
}

export function resolveExistingTeamworkSession(
  name: string,
  opts: ResolveTeamworkSessionOptions = {},
): TeamworkSessionRef {
  if (opts.scope) {
    const project =
      opts.scope === "global"
        ? GLOBAL_PROJECT_KEY
        : opts.cwd
          ? projectKey(opts.cwd)
          : currentProjectKey();
    if (!fs.existsSync(eventsPath(name, project))) {
      throw new Error(
        `Teamwork Session '${name}' not found in ${opts.scope} scope (${project})`,
      );
    }
    process.env.TRELLIS_TEAMWORK_PROJECT = project;
    return { name, scope: opts.scope, project, dir: sessionDir(name, project) };
  }

  const current = currentProjectKey();
  const projectMatches = listProjects()
    .filter((project) => project !== GLOBAL_PROJECT_KEY)
    .filter((project) => fs.existsSync(eventsPath(name, project)));
  const globalExists = fs.existsSync(eventsPath(name, GLOBAL_PROJECT_KEY));

  if (globalExists && projectMatches.length > 0) {
    throw new Error(
      `Teamwork Session '${name}' exists in global and project scopes. Use --scope global or --scope project.`,
    );
  }

  if (globalExists) {
    process.env.TRELLIS_TEAMWORK_PROJECT = GLOBAL_PROJECT_KEY;
    return {
      name,
      scope: "global",
      project: GLOBAL_PROJECT_KEY,
      dir: sessionDir(name, GLOBAL_PROJECT_KEY),
    };
  }

  if (fs.existsSync(eventsPath(name, current))) {
    process.env.TRELLIS_TEAMWORK_PROJECT = current;
    return {
      name,
      scope: "project",
      project: current,
      dir: sessionDir(name, current),
    };
  }

  if (projectMatches.length === 1) {
    process.env.TRELLIS_TEAMWORK_PROJECT = projectMatches[0];
    return {
      name,
      scope: "project",
      project: projectMatches[0],
      dir: sessionDir(name, projectMatches[0]),
    };
  }

  if (projectMatches.length > 1) {
    throw new Error(
      `Teamwork Session '${name}' exists in multiple project buckets: ${projectMatches.join(", ")}. Run from the owning project cwd or use --scope.`,
    );
  }

  throw new Error(
    `Teamwork Session '${name}' not found in current project bucket (${current}) or any known scope`,
  );
}

/**
 * Select the project bucket for an existing Teamwork Session in this CLI process.
 * Current cwd wins. If it is not there, fall back to a unique match across
 * all buckets so users can run `trellis teamwork send <name>` from a different cwd
 * without silently writing a second event stream.
 */
export function selectExistingTeamworkSessionProject(name: string): string {
  return resolveExistingTeamworkSession(name).project;
}
