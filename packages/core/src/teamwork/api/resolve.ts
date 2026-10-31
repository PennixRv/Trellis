import {
  sessionDir,
  resolveTeamworkSessionProjectForCreate,
  resolveExistingTeamworkSession,
} from "../internal/store/paths.js";
import type {
  TeamworkSessionRef,
  TeamworkSessionScope,
} from "../internal/store/schema.js";

export interface ResolveTeamworkSessionOptions {
  sessionId: string;
  scope?: TeamworkSessionScope;
  /** Storage project bucket key. Wins when set. */
  projectKey?: string;
  /** cwd used to derive the project bucket when scope is "project". */
  cwd?: string;
  /**
   * If true, do not require the Teamwork Session to exist on disk. Used for the
   * create path. Defaults to false (existence required).
   */
  forCreate?: boolean;
}

/**
 * Resolve a `TeamworkSessionRef` honoring `--scope`, an explicit `projectKey`,
 * or cwd-derived defaults. Mirrors the CLI's scope-resolution rules so
 * downstream consumers behave the same way.
 */
export function resolveTeamworkSession(opts: ResolveTeamworkSessionOptions): TeamworkSessionRef {
  if (opts.projectKey) {
    const project = opts.projectKey;
    return {
      name: opts.sessionId,
      scope: opts.scope ?? "project",
      project,
      dir: sessionDir(opts.sessionId, project),
    };
  }
  if (opts.forCreate) {
    return resolveTeamworkSessionProjectForCreate(opts.sessionId, {
      scope: opts.scope,
      cwd: opts.cwd,
    });
  }
  return resolveExistingTeamworkSession(opts.sessionId, {
    scope: opts.scope,
    cwd: opts.cwd,
  });
}
