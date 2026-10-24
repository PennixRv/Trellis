import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { loadAgent } from "./agent-loader.js";

export const TEAMMATE_ROLE_ID = "teammate";
export const TEAMMATE_PROFILES_PATH = ".trellis/agents/teammate-profiles.json";
export const REASONING_EFFORTS = ["medium", "high", "xhigh"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export type TeammateProvider = "claude" | "codex" | "dsh" | "copilot";

interface ProfileEntry {
  provider?: TeammateProvider;
  model?: string;
  reasoning_effort?: ReasoningEffort;
  options?: Record<string, string | number | boolean>;
}

interface ProfileFile {
  default_provider?: TeammateProvider;
  default_model?: string;
  profiles: Record<string, ProfileEntry>;
}

export interface ResolvedTeammateProfile {
  roleId: string;
  provider: TeammateProvider;
  model?: string;
  profile?: string;
  reasoningEffort?: ReasoningEffort;
  options: Record<string, string | number | boolean>;
  rolePrompt: string;
  rolePath: string;
  profilePath?: string;
  profileDigest?: string;
}

function text(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > 256 ||
    /[\r\n\0]/.test(value)
  ) {
    throw new Error(`${field} must be bounded text`);
  }
  return value.trim();
}

function provider(value: unknown, field: string): TeammateProvider | undefined {
  const result = text(value, field);
  if (result === undefined) return undefined;
  if (
    result !== "claude" &&
    result !== "codex" &&
    result !== "dsh" &&
    result !== "copilot"
  ) {
    throw new Error(`${field} must be claude, codex, dsh, or copilot`);
  }
  return result;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function loadProfiles(
  cwd: string,
): { file: ProfileFile; digest: string } | undefined {
  const filePath = path.resolve(cwd, TEAMMATE_PROFILES_PATH);
  if (!fs.existsSync(filePath)) return undefined;
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) {
    throw new Error(`invalid teammate profile file: ${TEAMMATE_PROFILES_PATH}`);
  }
  const raw = fs.readFileSync(filePath);
  const value = record(
    JSON.parse(raw.toString("utf8")),
    "teammate profile file",
  ) as unknown as ProfileFile;
  if (
    !value.profiles ||
    typeof value.profiles !== "object" ||
    Array.isArray(value.profiles)
  ) {
    throw new Error(
      "teammate profile file must contain an object named profiles",
    );
  }
  provider(value.default_provider, "default_provider");
  text(value.default_model, "default_model");
  for (const [id, entry] of Object.entries(value.profiles)) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) ||
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry)
    ) {
      throw new Error(`invalid teammate profile '${id}'`);
    }
    provider(entry.provider, `profiles.${id}.provider`);
    text(entry.model, `profiles.${id}.model`);
    if (
      entry.reasoning_effort !== undefined &&
      !REASONING_EFFORTS.includes(entry.reasoning_effort)
    ) {
      throw new Error(`profiles.${id}.reasoning_effort is invalid`);
    }
    if (entry.options !== undefined) {
      const options = record(entry.options, `profiles.${id}.options`);
      if (Object.keys(options).length > 32)
        throw new Error(`profiles.${id}.options has too many entries`);
      for (const [key, option] of Object.entries(options)) {
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(key))
          throw new Error(`profiles.${id}.options has an invalid key`);
        if (
          typeof option !== "string" &&
          typeof option !== "number" &&
          typeof option !== "boolean"
        ) {
          throw new Error(`profiles.${id}.options.${key} must be a scalar`);
        }
        if (typeof option === "number" && !Number.isFinite(option))
          throw new Error(`profiles.${id}.options.${key} must be finite`);
        if (typeof option === "string")
          text(option, `profiles.${id}.options.${key}`);
      }
    }
  }
  return {
    file: value,
    digest: crypto.createHash("sha256").update(raw).digest("hex"),
  };
}

export function resolveTeammateProfile(input: {
  cwd: string;
  profile?: string;
  provider?: TeammateProvider;
  model?: string;
  roleId?: string;
}): ResolvedTeammateProfile {
  const roleId = input.roleId ?? TEAMMATE_ROLE_ID;
  if (roleId !== TEAMMATE_ROLE_ID)
    throw new Error(`unsupported role '${roleId}'`);
  const agent = loadAgent(roleId, input.cwd);
  const loaded = loadProfiles(input.cwd);
  const profile = input.profile
    ? loaded?.file.profiles[input.profile]
    : undefined;
  if (input.profile && !profile)
    throw new Error(`unknown teammate profile '${input.profile}'`);
  const selectedProvider =
    input.provider ?? profile?.provider ?? loaded?.file.default_provider;
  if (!selectedProvider)
    throw new Error(
      "teammate provider must be selected explicitly or by profile",
    );
  const selectedModel =
    input.model ?? profile?.model ?? loaded?.file.default_model;
  return {
    roleId,
    provider: selectedProvider,
    ...(selectedModel ? { model: selectedModel } : {}),
    ...(input.profile ? { profile: input.profile } : {}),
    ...(profile?.reasoning_effort
      ? { reasoningEffort: profile.reasoning_effort }
      : {}),
    options: profile?.options ?? {},
    rolePrompt: agent.systemPrompt,
    rolePath: agent.filePath,
    ...(loaded
      ? {
          profilePath: path.resolve(input.cwd, TEAMMATE_PROFILES_PATH),
          profileDigest: loaded.digest,
        }
      : {}),
  };
}
