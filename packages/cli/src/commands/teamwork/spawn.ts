import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { InboxPolicy } from "@pennixrv/trellis-core/teamwork";

import { loadAgent } from "./agent-loader.js";
import { resolveTeammateProfile, type ReasoningEffort } from "./profiles.js";
import type { CodexSandboxMode } from "./adapters/codex.js";
import type { Provider } from "./adapters/index.js";
import { assertTeammateProviderOptions } from "./teammate-adapters.js";
import { assembleContext } from "./context-loader.js";
import { buildTeamworkInstructions } from "./prompt.js";
import { resolveTrustedRoots } from "./context-trust.js";
import {
  enforceSpawnBudget,
  formatBudgetOverflowError,
  resolveTeammateGuardConfig,
} from "./guard.js";
import { withLock } from "./store/lock.js";
import {
  sessionDir,
  projectDir,
  resolveExistingTeamworkSession,
  workerFile,
  workerLockPath,
} from "./store/paths.js";
import { parseTeamworkSessionScope } from "./store/schema.js";
import { writeSupervisorConfig } from "./supervisor.js";

export interface SpawnOptions {
  quiet?: boolean;
  provider?: Provider;
  as?: string;
  agent?: string;
  cwd?: string;
  model?: string;
  profile?: string;
  configuration?: string;
  reasoningEffort?: ReasoningEffort;
  resume?: string;
  /** Codex-only: explicit override; the default is no sandbox. */
  sandbox?: CodexSandboxMode;
  /** Auto-kill the teammate process after this many milliseconds (anti-zombie). */
  timeoutMs?: number;
  /** Emit supervisor_warning this many milliseconds before timeout. */
  warnBeforeMs?: number;
  /** Files (or globs) delivered as reference data with the first task. */
  files?: string[];
  /** Trellis JSONL manifests describing inline or file reference data. */
  jsonls?: string[];
  scope?: string;
  /** Identity recorded as the `spawned` event author. Defaults to
   *  the calling teammate (`TRELLIS_TEAMWORK_AS` env) or "main". */
  by?: string;
  /** Teammate inbox delivery policy (default `explicitOnly`). */
  inboxPolicy?: InboxPolicy;
  /**
   * OOM-guard idle-cleanup TTL for this teammate, in ms. `0` disables
   * idle cleanup. Overrides env / config / built-in default.
   */
  idleTimeoutMs?: number;
  /**
   * OOM-guard live-teammate budget for this spawn. `0` disables the
   * spawn-time budget check. Overrides env / config / built-in default.
   */
  maxLiveWorkers?: number;
}

interface ResolvedSpawn {
  provider: Provider;
  as: string;
  systemPrompt: string;
  context: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  options?: Record<string, string | number | boolean>;
  contextFiles: string[];
  contextManifests: string[];
}

function resolveSpawn(sessionId: string, opts: SpawnOptions): ResolvedSpawn {
  const cwd = opts.cwd ?? process.cwd();
  const trustedRoots = resolveTrustedRoots(cwd);
  let agentBody: string | undefined;
  let provider = opts.provider;
  let model = opts.model;
  let as = opts.as;
  let reasoningEffort = opts.reasoningEffort;
  let options: Record<string, string | number | boolean> | undefined;

  if (
    !opts.agent ||
    opts.agent === "teammate" ||
    opts.profile ||
    opts.configuration
  ) {
    if (opts.agent && opts.agent !== "teammate")
      throw new Error(
        "--profile/--configuration cannot be combined with a generic --agent",
      );
    const resolved = resolveTeammateProfile({
      cwd,
      profile: opts.profile,
      configuration: opts.configuration,
      provider,
      model,
      reasoningEffort,
    });
    agentBody = resolved.rolePrompt;
    provider = resolved.provider;
    model = resolved.model;
    reasoningEffort = resolved.reasoningEffort;
    options = resolved.options;
    as ??= resolved.profile;
  } else if (opts.agent) {
    const agent = loadAgent(opts.agent, cwd, trustedRoots);
    agentBody = agent.systemPrompt || undefined;
    provider = provider ?? agent.provider;
    model = model ?? agent.model;
    as = as ?? agent.name;
  }

  if (!provider) {
    throw new Error(
      "Missing --provider (and the agent definition has no `provider:` frontmatter)",
    );
  }
  if (!as) {
    throw new Error("Missing --as (no agent name to fall back to)");
  }

  assertTeammateProviderOptions(provider, options);

  const context = assembleContext(cwd, opts.files, opts.jsonls, trustedRoots);
  const systemPrompt = buildSystemPrompt(sessionId, as, agentBody);

  return {
    provider,
    as,
    systemPrompt,
    context: context.prompt,
    model,
    reasoningEffort,
    options,
    contextFiles: context.paths,
    contextManifests: context.manifests,
  };
}

/**
 * Compose the teammate's system prompt: Trellis Teamwork protocol prefix
 * + agent body (if any).
 *
 * Adapters choose the actual instruction channel; ACP has user content only.
 * Reference data is delivered with the first task, never in role instructions.
 */
function buildSystemPrompt(
  sessionId: string,
  workerName: string,
  agentBody: string | undefined,
): string {
  return buildTeamworkInstructions(
    `会话：${safeIdentifier(sessionId)}；成员：${safeIdentifier(workerName)}。\n\n${agentBody ?? "只完成协调者指定的研究、审查、验证或证据任务；不实施产品代码，不修改源码、测试、配置、任务或 Git 状态，不委派其他 agent。"}`,
    "interactive",
  );
}

/** Restrict Teamwork Session ID / teammate names that flow into the protocol header so
 *  they can't carry newlines or fake protocol directives. The CLI layer
 *  already validates names but defense in depth keeps prompt injection
 *  from this surface impossible. */
function safeIdentifier(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\r\n\x00-\x08\x0b-\x1f\x7f]/g, "");
}

export async function teamworkSessionSpawn(
  sessionId: string,
  opts: SpawnOptions,
): Promise<{
  pid: number;
  log: string;
  worker: string;
  provider: Provider;
  model?: string;
}> {
  const ref = resolveExistingTeamworkSession(sessionId, {
    scope: parseTeamworkSessionScope(opts.scope),
  });
  if (!fs.existsSync(sessionDir(sessionId, ref.project))) {
    throw new Error(
      `Teamwork Session '${sessionId}' not found at ${sessionDir(sessionId, ref.project)}`,
    );
  }

  const resolved = resolveSpawn(sessionId, opts);

  // OOM guard: enforce the live-teammate budget for this project/scope before
  // forking a supervisor. Expired idle teammates are cleaned first; if the
  // budget is still exhausted we reject rather than guess which non-
  // expired teammate to kill.
  const guardPolicy = resolveTeammateGuardConfig({
    ...(opts.idleTimeoutMs !== undefined
      ? { flagIdleTimeoutMs: opts.idleTimeoutMs }
      : {}),
    ...(opts.maxLiveWorkers !== undefined
      ? { flagMaxLiveWorkers: opts.maxLiveWorkers }
      : {}),
  });
  // Serialize the budget check across the whole project bucket. A per-teammate
  // lock is not enough: two different teammate names could otherwise both see
  // a free slot and fork supervisors at the same time.
  return withLock(
    path.join(projectDir(ref.project), ".worker-guard.lock"),
    async () => {
      const guard = await enforceSpawnBudget({
        projectKey: ref.project,
        policy: guardPolicy,
      });
      if (guard.cleaned.length > 0) {
        process.stderr.write(
          `[teamwork guard] cleaned ${guard.cleaned.length} idle teammate(s) past TTL ${guardPolicy.idleTimeoutMs}ms: ${guard.cleaned
            .map((w) => `${w.sessionId}/${w.workerId}`)
            .join(", ")}\n`,
        );
      }
      if (!guard.allowed) {
        throw new Error(
          formatBudgetOverflowError({
            projectKey: ref.project,
            live: guard.remaining,
            limit: guardPolicy.maxLiveWorkers,
          }),
        );
      }

      // Acquire the teammate-level lock so a concurrent spawn / kill can't race
      // with us. The lock is released as soon as we've handed off to a detached
      // supervisor (pid file in place).
      return withLock(
        workerLockPath(sessionId, resolved.as, ref.project),
        async () => {
          return spawnLocked(
            sessionId,
            resolved,
            opts,
            ref.project,
            guardPolicy.idleTimeoutMs,
          );
        },
      );
    },
  );
}

async function spawnLocked(
  sessionId: string,
  resolved: ResolvedSpawn,
  opts: SpawnOptions,
  project: string,
  idleTimeoutMs: number,
): Promise<{
  pid: number;
  log: string;
  worker: string;
  provider: Provider;
  model?: string;
}> {
  // Re-check teammate name not already busy (now safe under the lock).
  const pidPath = workerFile(sessionId, resolved.as, "pid", project);
  if (fs.existsSync(pidPath)) {
    const existing = Number(fs.readFileSync(pidPath, "utf-8").trim());
    if (existing && processAlive(existing)) {
      throw new Error(
        `Teammate '${resolved.as}' is already running in Teamwork Session '${sessionId}' (pid ${existing})`,
      );
    }
  }

  const spawnedBy =
    opts.by ??
    (typeof process.env.TRELLIS_TEAMWORK_AS === "string" &&
    process.env.TRELLIS_TEAMWORK_AS.length > 0
      ? process.env.TRELLIS_TEAMWORK_AS
      : "main");

  const configPath = writeSupervisorConfig(
    sessionId,
    resolved.as,
    {
      provider: resolved.provider,
      cwd: opts.cwd ?? process.cwd(),
      systemPrompt: resolved.systemPrompt,
      context: resolved.context,
      model: resolved.model,
      reasoningEffort: resolved.reasoningEffort,
      options: resolved.options,
      resume: opts.resume,
      sandbox: opts.sandbox,
      timeoutMs: opts.timeoutMs,
      warnBeforeMs: opts.warnBeforeMs,
      idleTimeoutMs,
      spawnedBy,
      ...(opts.inboxPolicy ? { inboxPolicy: opts.inboxPolicy } : {}),
      ...(opts.agent ? { agent: opts.agent } : {}),
      ...(resolved.contextFiles.length > 0
        ? { contextFiles: resolved.contextFiles }
        : {}),
      ...(resolved.contextManifests.length > 0
        ? { contextManifests: resolved.contextManifests }
        : {}),
    },
    project,
  );

  const supervisorBinary = resolveCliEntry();
  const reservationPath = workerFile(
    sessionId,
    resolved.as,
    "reservation",
    project,
  );
  fs.writeFileSync(
    reservationPath,
    JSON.stringify({
      sessionId: sessionId,
      worker: resolved.as,
      createdAt: new Date().toISOString(),
    }),
    "utf-8",
  );
  const child = spawn(
    process.execPath,
    [
      supervisorBinary,
      "teamwork",
      "__supervisor",
      sessionId,
      resolved.as,
      configPath,
    ],
    {
      detached: true,
      stdio: "ignore",
      // Propagate the current project bucket so the detached supervisor
      // resolves paths into the SAME bucket the CLI just wrote into,
      // regardless of where the supervisor's process.cwd() ends up.
      env: {
        ...process.env,
        TRELLIS_TEAMWORK_PROJECT: project,
      },
    },
  );

  // Wait for either successful spawn or an error event before considering
  // the supervisor "launched". Without this the parent would happily return
  // pid=-1 on a missing node binary or fork failure.
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      // Clean up partial config before bubbling the failure up.
      try {
        fs.unlinkSync(configPath);
      } catch {
        // ignore
      }
      try {
        fs.unlinkSync(reservationPath);
      } catch {
        // ignore
      }
      reject(
        new Error(
          `Failed to launch supervisor for teammate '${resolved.as}': ${err.message}`,
        ),
      );
    });
  });
  if (child.pid !== undefined) {
    fs.writeFileSync(pidPath, String(child.pid));
  }
  child.unref();

  const result = {
    pid: child.pid ?? -1,
    log: workerFile(sessionId, resolved.as, "log", project),
    worker: resolved.as,
    provider: resolved.provider,
    ...(resolved.model ? { model: resolved.model } : {}),
  };
  if (!opts.quiet) console.log(JSON.stringify(result));
  return result;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveCliEntry(): string {
  // When running from the built bundle, import.meta.url points at
  // dist/commands/teamwork/spawn.js. The CLI entry is dist/cli/index.js.
  const here = fileURLToPath(import.meta.url);
  const distRoot = path.resolve(path.dirname(here), "..", "..");
  return path.join(distRoot, "cli", "index.js");
}
