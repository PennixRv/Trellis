import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { DIR_NAMES } from "../../constants/paths.js";

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
}

const DEFAULT_CONFIG: TeammateRuntimeConfig = {
  teammate: { maxConcurrency: 1 },
  guard: { maxLiveTeammates: 6, nonBatchReserved: 0 },
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
  let inChannel = false;
  let inSection = false;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trimEnd();
    if (/^channel:\s*$/.test(trimmed)) {
      inChannel = true;
      inSection = false;
      continue;
    }
    if (inChannel && new RegExp(`^  ${section}:\\s*$`).test(trimmed)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      const match = new RegExp(`^    ${key}:\\s*(-?\\d+)\\s*$`).exec(trimmed);
      if (match) return Number(match[1]);
      if (!/^ {4}\S/.test(line)) inSection = false;
    }
    if (inChannel && /^\S/.test(line) && !/^channel:\s*$/.test(trimmed)) {
      inChannel = false;
      inSection = false;
    }
  }
  return undefined;
}

export function resolveTeammateRuntimeConfig(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): TeammateRuntimeConfig {
  const configPath = path.join(cwd, DIR_NAMES.WORKFLOW, "config.yaml");
  let content = "";
  try {
    content = fs.readFileSync(configPath, "utf8");
  } catch {
    // Built-in defaults are intentionally conservative.
  }
  const maxConcurrency =
    integer(
      env.TRELLIS_CHANNEL_TEAMMATE_MAX_CONCURRENCY
        ? Number(env.TRELLIS_CHANNEL_TEAMMATE_MAX_CONCURRENCY)
        : yamlInteger(content, "teammate", "max_concurrency"),
      "channel.teammate.max_concurrency",
      true,
    ) ?? DEFAULT_CONFIG.teammate.maxConcurrency;
  const maxLiveTeammates =
    integer(
      env.TRELLIS_CHANNEL_MAX_LIVE_TEAMMATES
        ? Number(env.TRELLIS_CHANNEL_MAX_LIVE_TEAMMATES)
        : yamlInteger(content, "teammate_guard", "max_live_teammates"),
      "channel.teammate_guard.max_live_teammates",
      true,
    ) ?? DEFAULT_CONFIG.guard.maxLiveTeammates;
  const nonBatchReserved =
    integer(
      env.TRELLIS_CHANNEL_TEAMMATE_RESERVED
        ? Number(env.TRELLIS_CHANNEL_TEAMMATE_RESERVED)
        : yamlInteger(content, "teammate_guard", "non_batch_reserved"),
      "channel.teammate_guard.non_batch_reserved",
    ) ?? DEFAULT_CONFIG.guard.nonBatchReserved;
  return {
    teammate: { maxConcurrency },
    guard: { maxLiveTeammates, nonBatchReserved },
    ...(content
      ? {
          sourceDigest: crypto
            .createHash("sha256")
            .update(content)
            .digest("hex"),
        }
      : {}),
  };
}

export function effectiveTeammateCapacity(input: {
  requested?: number;
  config: TeammateRuntimeConfig;
  verifiedHostCap: number;
}): number {
  integer(
    input.config.teammate.maxConcurrency,
    "channel.teammate.max_concurrency",
    true,
  );
  integer(
    input.config.guard.maxLiveTeammates,
    "channel.teammate_guard.max_live_teammates",
    true,
  );
  integer(
    input.config.guard.nonBatchReserved,
    "channel.teammate_guard.non_batch_reserved",
  );
  const requested = input.requested ?? input.config.teammate.maxConcurrency;
  integer(requested, "batch.requested_capacity", true);
  integer(input.verifiedHostCap, "verified_host_cap", true);
  const availableGuard =
    input.config.guard.maxLiveTeammates - input.config.guard.nonBatchReserved;
  if (availableGuard <= 0) {
    throw new Error(
      "channel.teammate_guard has no capacity after non-batch reservations",
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
  return capacity;
}
