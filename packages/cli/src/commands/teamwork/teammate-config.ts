import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { DIR_NAMES } from "../../constants/paths.js";
import {
  DEFAULT_TEAMWORK_CONFIG,
  readCoordinationConfig,
  type CoordinationMode,
} from "./coordination.js";

export interface TeammateConfig {
  maxConcurrency: number;
}

export interface TeammateGuardConfig {
  maxLiveTeammates: number;
  nonBatchReserved: number;
}

export interface TeammateRuntimeConfig {
  teammate: TeammateConfig;
  guard: TeammateGuardConfig;
  sourceDigest?: string;
  source?: string;
  diagnostics?: string[];
}

const DEFAULT_CONFIG: TeammateRuntimeConfig = {
  teammate: {
    maxConcurrency: DEFAULT_TEAMWORK_CONFIG.modes.general.max_concurrency,
  },
  guard: {
    maxLiveTeammates: DEFAULT_TEAMWORK_CONFIG.resources.max_live_teammates,
    nonBatchReserved: DEFAULT_TEAMWORK_CONFIG.resources.non_batch_reserved,
  },
};

function integer(
  value: number | undefined,
  field: string,
  positive = false,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (positive ? value <= 0 : value < 0)) {
    throw new Error(
      `${field} must be a ${positive ? "positive" : "non-negative"} integer`,
    );
  }
  return value;
}

function yamlInteger(
  content: string,
  section: string,
  key: string,
): number | undefined {
  const lines = content.split("\n");
  let inTeamwork = false;
  let inSection = false;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trimEnd();
    if (/^teamwork:\s*$/.test(trimmed)) {
      inTeamwork = true;
      inSection = false;
      continue;
    }
    if (inTeamwork && new RegExp(`^  ${section}:\\s*$`).test(trimmed)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      const match = new RegExp(`^    ${key}:\\s*(-?\\d+)\\s*$`).exec(trimmed);
      if (match) return Number(match[1]);
      if (!/^ {4}\S/.test(line)) inSection = false;
    }
    if (inTeamwork && /^\S/.test(line) && !/^teamwork:\s*$/.test(trimmed)) {
      inTeamwork = false;
      inSection = false;
    }
  }
  return undefined;
}

export function resolveTeammateRuntimeConfig(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  mode?: CoordinationMode,
): TeammateRuntimeConfig {
  const configPath = path.join(cwd, DIR_NAMES.WORKFLOW, "config.yaml");
  let content = "";
  try {
    content = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const resolved = readCoordinationConfig(cwd);
  const selected = mode ?? resolved.config.default_mode;
  const legacyConcurrency = yamlInteger(content, "teammate", "max_concurrency");
  const legacyLive = yamlInteger(
    content,
    "teammate_guard",
    "max_live_teammates",
  );
  const legacyReserved = yamlInteger(
    content,
    "teammate_guard",
    "non_batch_reserved",
  );
  const diagnostics: string[] = [];
  if (
    legacyConcurrency !== undefined ||
    legacyLive !== undefined ||
    legacyReserved !== undefined
  )
    diagnostics.push(
      resolved.legacy
        ? "Legacy YAML capacity is active; migrate to .trellis/teamwork.json schema 2."
        : "Legacy YAML capacity keys are ignored by teamwork.json schema 2; review trellis update output and merge custom config.yaml manually if needed.",
    );
  if (resolved.legacy && resolved.source !== "built-in")
    diagnostics.push(
      "Legacy teamwork.json schema 1; update to schema 2 for mode-specific capacity.",
    );
  for (const key of [
    "TRELLIS_TEAMWORK_TEAMMATE_MAX_CONCURRENCY",
    "TRELLIS_TEAMWORK_MAX_LIVE_TEAMMATES",
    "TRELLIS_TEAMWORK_TEAMMATE_RESERVED",
  ])
    if (env[key])
      diagnostics.push(
        `${key} explicitly overrides the project capacity policy.`,
      );
  const maxConcurrency =
    integer(
      env.TRELLIS_TEAMWORK_TEAMMATE_MAX_CONCURRENCY
        ? Number(env.TRELLIS_TEAMWORK_TEAMMATE_MAX_CONCURRENCY)
        : resolved.legacy && legacyConcurrency !== undefined
          ? legacyConcurrency
          : resolved.config.modes[selected].max_concurrency,
      "teamwork.teammate.max_concurrency",
      true,
    ) ?? DEFAULT_CONFIG.teammate.maxConcurrency;
  const maxLiveTeammates =
    integer(
      env.TRELLIS_TEAMWORK_MAX_LIVE_TEAMMATES
        ? Number(env.TRELLIS_TEAMWORK_MAX_LIVE_TEAMMATES)
        : resolved.legacy && legacyLive !== undefined
          ? legacyLive
          : resolved.config.resources.max_live_teammates,
      "teamwork.teammate_guard.max_live_teammates",
    ) ?? DEFAULT_CONFIG.guard.maxLiveTeammates;
  const nonBatchReserved =
    integer(
      env.TRELLIS_TEAMWORK_TEAMMATE_RESERVED
        ? Number(env.TRELLIS_TEAMWORK_TEAMMATE_RESERVED)
        : resolved.legacy && legacyReserved !== undefined
          ? legacyReserved
          : resolved.config.resources.non_batch_reserved,
      "teamwork.teammate_guard.non_batch_reserved",
    ) ?? DEFAULT_CONFIG.guard.nonBatchReserved;
  return {
    teammate: { maxConcurrency },
    guard: { maxLiveTeammates, nonBatchReserved },
    source: resolved.source,
    diagnostics,
    sourceDigest: crypto
      .createHash("sha256")
      .update(
        content +
          resolved.configDigest +
          JSON.stringify({
            maxConcurrency,
            maxLiveTeammates,
            nonBatchReserved,
          }),
      )
      .digest("hex"),
  };
}

export function effectiveTeammateCapacity(input: {
  requested?: number;
  assignmentCount?: number;
  config: TeammateRuntimeConfig;
  verifiedHostCap: number;
}): number {
  integer(
    input.config.teammate.maxConcurrency,
    "teamwork.teammate.max_concurrency",
    true,
  );
  integer(
    input.config.guard.maxLiveTeammates,
    "teamwork.teammate_guard.max_live_teammates",
  );
  integer(
    input.config.guard.nonBatchReserved,
    "teamwork.teammate_guard.non_batch_reserved",
  );
  const requested = input.requested ?? input.config.teammate.maxConcurrency;
  integer(requested, "batch.requested_capacity", true);
  integer(input.verifiedHostCap, "verified_host_cap", true);
  const availableGuard =
    input.config.guard.maxLiveTeammates === 0
      ? Infinity
      : input.config.guard.maxLiveTeammates -
        input.config.guard.nonBatchReserved;
  if (availableGuard <= 0) {
    throw new Error(
      "teamwork.teammate_guard has no capacity after non-batch reservations",
    );
  }
  const capacity = Math.min(
    requested,
    input.config.teammate.maxConcurrency,
    availableGuard,
    input.verifiedHostCap,
  );
  if (capacity <= 0)
    throw new Error("effective teammate capacity must be positive");
  if (input.requested !== undefined && input.requested > capacity) {
    throw new Error(
      `requested teammate capacity ${input.requested} exceeds verified limit ${capacity}`,
    );
  }
  if (input.assignmentCount !== undefined)
    integer(input.assignmentCount, "batch.assignment_count", true);
  return Math.min(capacity, input.assignmentCount ?? capacity);
}
