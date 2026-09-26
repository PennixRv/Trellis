import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PROFILE_CONFIG_RELATIVE = ".trellis/agents/subnode-profiles.json";
const MAX_PROFILE_CONFIG_BYTES = 64 * 1024;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const REASONING_EFFORTS = ["medium", "high", "xhigh"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export type ModelSource = "explicit" | "profile" | "default" | "agent" | "none";
export type ReasoningEffortSource = "explicit" | "profile" | "none";

interface ProfileDefinition {
  model?: string;
  reasoning_effort: ReasoningEffort;
}

interface ProfileConfig {
  default_model: string;
  profiles: Record<string, ProfileDefinition>;
}

export interface ResolvedSubnodeProfile {
  profile?: string;
  model?: string;
  modelSource: ModelSource;
  reasoningEffort?: ReasoningEffort;
  reasoningEffortSource: ReasoningEffortSource;
  reasoningEffortReason?: string;
  profileConfigPath?: string;
  profileConfigDigest?: string;
}

function fail(message: string): never {
  throw new Error(`[channel profile] ${message}`);
}

function text(value: unknown, field: string, max = 256): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  const result = value.trim();
  if (result.length > max || result.includes("\0") || /[\r\n]/.test(result)) {
    fail(`${field} is not a bounded text value`);
  }
  return result;
}

function id(value: unknown, field: string): string {
  const result = text(value, field, 64);
  if (!ID_RE.test(result)) fail(`${field} must match ${ID_RE.source}`);
  return result;
}

function effort(value: unknown, field: string): ReasoningEffort {
  if (
    typeof value !== "string" ||
    !REASONING_EFFORTS.includes(value as ReasoningEffort)
  ) {
    fail(`${field} must be one of ${REASONING_EFFORTS.join(", ")}`);
  }
  return value as ReasoningEffort;
}

function rejectSymlinkComponents(root: string, target: string): void {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`profile config is outside the project root: ${target}`);
  }
  let current = absoluteRoot;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        fail(`refusing symlinked profile config path component: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function loadConfig(cwd: string): {
  config: ProfileConfig;
  relativePath: string;
  digest: string;
} {
  const configPath = path.resolve(cwd, PROFILE_CONFIG_RELATIVE);
  rejectSymlinkComponents(cwd, configPath);

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      fail(`profile config does not exist: ${PROFILE_CONFIG_RELATIVE}`);
    }
    throw error;
  }
  if (!stat.isFile())
    fail(`profile config is not a regular file: ${PROFILE_CONFIG_RELATIVE}`);
  if (stat.size > MAX_PROFILE_CONFIG_BYTES) {
    fail(`profile config exceeds ${MAX_PROFILE_CONFIG_BYTES} bytes`);
  }

  const raw = fs.readFileSync(configPath);
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    fail("profile config is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("profile config must be a JSON object");
  }
  const input = value as Record<string, unknown>;
  const defaultModel = text(input.default_model, "default_model");
  const profilesValue = input.profiles;
  if (
    !profilesValue ||
    typeof profilesValue !== "object" ||
    Array.isArray(profilesValue)
  ) {
    fail("profiles must be a non-empty object");
  }
  const profiles = Object.create(null) as Record<string, ProfileDefinition>;
  for (const [profileId, rawProfile] of Object.entries(
    profilesValue as Record<string, unknown>,
  )) {
    id(profileId, "profile id");
    if (
      !rawProfile ||
      typeof rawProfile !== "object" ||
      Array.isArray(rawProfile)
    ) {
      fail(`profiles.${profileId} must be an object`);
    }
    const definition = rawProfile as Record<string, unknown>;
    const parsed: ProfileDefinition = {
      reasoning_effort: effort(
        definition.reasoning_effort,
        `profiles.${profileId}.reasoning_effort`,
      ),
    };
    if (definition.model !== undefined) {
      parsed.model = text(definition.model, `profiles.${profileId}.model`);
    }
    profiles[profileId] = parsed;
  }
  if (Object.keys(profiles).length === 0) fail("profiles must not be empty");

  return {
    config: { default_model: defaultModel, profiles },
    relativePath: PROFILE_CONFIG_RELATIVE,
    digest: crypto.createHash("sha256").update(raw).digest("hex"),
  };
}

export function parseReasoningEffort(
  value: string | undefined,
): ReasoningEffort | undefined {
  return value === undefined ? undefined : effort(value, "--reasoning-effort");
}

export function resolveSubnodeProfile(input: {
  cwd: string;
  agent?: string;
  provider?: string;
  agentModel?: string;
  model?: string;
  profile?: string;
  reasoningEffort?: string;
  reasoningEffortReason?: string;
}): ResolvedSubnodeProfile {
  const explicitEffort = parseReasoningEffort(input.reasoningEffort);
  const explicitModel =
    input.model === undefined ? undefined : text(input.model, "--model");
  if (explicitEffort && input.provider !== "codex") {
    fail("--reasoning-effort is only supported for Codex workers");
  }
  if (input.reasoningEffortReason !== undefined && input.provider !== "codex") {
    fail("--reasoning-effort-reason is only supported for Codex workers");
  }
  if (input.profile !== undefined) {
    if (input.agent !== "subnode") {
      fail("--profile requires --agent subnode");
    }
    if (input.provider !== "codex") {
      fail("--profile requires a Codex worker");
    }
  }

  let profileConfig: ReturnType<typeof loadConfig> | undefined;
  let definition: ProfileDefinition | undefined;
  if (input.profile !== undefined) {
    const profileId = id(input.profile, "--profile");
    profileConfig = loadConfig(input.cwd);
    definition = profileConfig.config.profiles[profileId];
    if (!definition) fail(`unknown profile '${profileId}'`);
  }

  const resolvedModel =
    explicitModel ??
    definition?.model ??
    (definition ? profileConfig?.config.default_model : input.agentModel);
  const modelSource: ResolvedSubnodeProfile["modelSource"] =
    explicitModel !== undefined
      ? "explicit"
      : definition?.model
        ? "profile"
        : definition
          ? "default"
          : input.agentModel
            ? "agent"
            : "none";
  const resolvedEffort = explicitEffort ?? definition?.reasoning_effort;
  const reasoningEffortSource: ResolvedSubnodeProfile["reasoningEffortSource"] =
    explicitEffort ? "explicit" : definition ? "profile" : "none";
  const reason =
    input.reasoningEffortReason === undefined
      ? undefined
      : text(input.reasoningEffortReason, "--reasoning-effort-reason", 1024);
  if (reason && !resolvedEffort) {
    fail("--reasoning-effort-reason requires a reasoning effort");
  }
  if (resolvedEffort === "xhigh" && !reason) {
    fail("effective xhigh reasoning effort requires --reasoning-effort-reason");
  }

  return {
    ...(input.profile !== undefined
      ? { profile: id(input.profile, "--profile") }
      : {}),
    ...(resolvedModel ? { model: resolvedModel } : {}),
    modelSource,
    ...(resolvedEffort ? { reasoningEffort: resolvedEffort } : {}),
    reasoningEffortSource,
    ...(reason ? { reasoningEffortReason: reason } : {}),
    ...(profileConfig
      ? {
          profileConfigPath: profileConfig.relativePath,
          profileConfigDigest: profileConfig.digest,
        }
      : {}),
  };
}
