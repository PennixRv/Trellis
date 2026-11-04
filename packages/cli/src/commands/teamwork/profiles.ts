import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { loadAgent } from "./agent-loader.js";

export const TEAMMATE_ROLE_ID = "teammate";
export const TEAMMATE_PROFILES_PATH = ".trellis/agents/teammate-profiles.json";
export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export type TeammateProvider = "claude" | "codex" | "dsh" | "copilot";

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const boundedText = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[^\r\n\0]+$/);
const optionsSchema = z
  .record(
    z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
    z.union([boundedText, z.number().finite(), z.boolean()]),
  )
  .refine(
    (value) => Object.keys(value).length <= 32,
    "too many provider options",
  );
const executionSchema = z
  .object({
    provider: z.enum(["claude", "codex", "dsh", "copilot"]),
    model: boundedText,
    reasoning_effort: z.enum(REASONING_EFFORTS).optional(),
    options: optionsSchema.optional(),
  })
  .strict();
const profileSchema = z
  .object({
    role: boundedText,
    default_configuration: identifier,
    configurations: z
      .record(identifier, executionSchema)
      .refine(
        (entries) =>
          Object.keys(entries).length >= 2 && Object.keys(entries).length <= 3,
        "each profile requires two or three configurations",
      ),
  })
  .strict()
  .refine(
    (entry) => Object.hasOwn(entry.configurations, entry.default_configuration),
    "default_configuration must name a configuration in this profile",
  );
const profilesSchema = z
  .object({
    schema_version: z.literal(2),
    default_profile: identifier,
    profiles: z.record(identifier, profileSchema),
  })
  .strict()
  .refine(
    (file) => Object.hasOwn(file.profiles, file.default_profile),
    "default_profile must name an existing profile",
  );

export interface ResolvedTeammateProfile {
  roleId: "teammate";
  provider: TeammateProvider;
  model: string;
  profile: string;
  configuration: string;
  reasoningEffort?: ReasoningEffort;
  options: Record<string, string | number | boolean>;
  rolePrompt: string;
  rolePath: string;
  professionalRolePath: string;
  roleDigest: string;
  profilePath: string;
  profileDigest: string;
}

export const frozenProfileSchema = z
  .object({
    roleId: z.literal("teammate"),
    provider: executionSchema.shape.provider,
    model: boundedText,
    profile: identifier,
    configuration: identifier,
    reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
    options: optionsSchema,
    rolePrompt: z
      .string()
      .min(1)
      .max(128 * 1024),
    rolePath: boundedText,
    professionalRolePath: boundedText,
    roleDigest: z.string().regex(/^[a-f0-9]{64}$/),
    profilePath: boundedText,
    profileDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

/** Configuration and role cards are project assets, never ambient or symlinked instructions. */
export function readTeamworkAsset(cwd: string, relative: string): string {
  const root = path.resolve(cwd);
  const target = path.resolve(root, relative);
  const local = path.relative(root, target);
  if (
    !local ||
    local.startsWith(`..${path.sep}`) ||
    local === ".." ||
    path.isAbsolute(local)
  )
    throw new Error(`Teamwork asset must stay within the project: ${relative}`);
  let current = root;
  for (const part of local.split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink())
      throw new Error(`Teamwork asset must not contain symlinks: ${relative}`);
  }
  const stat = fs.statSync(target);
  if (!stat.isFile() || stat.size > 64 * 1024)
    throw new Error(
      `Teamwork asset must be a regular file of at most 64 KiB: ${relative}`,
    );
  return fs.readFileSync(target, "utf8");
}

export function resolveTeammateProfile(input: {
  cwd: string;
  profile?: string;
  configuration?: string;
  provider?: TeammateProvider;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  options?: Record<string, string | number | boolean>;
  roleId?: string;
}): ResolvedTeammateProfile {
  if (input.roleId !== undefined && input.roleId !== TEAMMATE_ROLE_ID)
    throw new Error(`unsupported role '${input.roleId}'`);
  const raw = readTeamworkAsset(input.cwd, TEAMMATE_PROFILES_PATH);
  const file = profilesSchema.parse(JSON.parse(raw));
  const profileId = input.profile ?? file.default_profile;
  const profile = Object.hasOwn(file.profiles, profileId)
    ? file.profiles[profileId]
    : undefined;
  if (!profile) throw new Error(`unknown teammate profile '${profileId}'`);
  const configuration = input.configuration ?? profile.default_configuration;
  const selected = Object.hasOwn(profile.configurations, configuration)
    ? profile.configurations[configuration]
    : undefined;
  if (!selected)
    throw new Error(
      `unknown configuration '${configuration}' in profile '${profileId}'`,
    );
  const execution = executionSchema.parse({
    ...selected,
    ...(input.provider !== undefined ? { provider: input.provider } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.reasoningEffort !== undefined
      ? { reasoning_effort: input.reasoningEffort }
      : {}),
    options: { ...selected.options, ...input.options },
  });
  const rolePath = ".trellis/agents/teammate.md";
  const common = readTeamworkAsset(input.cwd, rolePath);
  if (
    !profile.role.startsWith("profiles/") ||
    path.extname(profile.role) !== ".md"
  )
    throw new Error(
      "professional role must reference profiles/*.md under .trellis/agents",
    );
  const professionalRolePath = path.posix.join(".trellis/agents", profile.role);
  if (!professionalRolePath.startsWith(".trellis/agents/profiles/"))
    throw new Error(
      "professional role must stay inside .trellis/agents/profiles",
    );
  const professional = readTeamworkAsset(input.cwd, professionalRolePath);
  const agent = loadAgent(TEAMMATE_ROLE_ID, input.cwd);
  return {
    roleId: TEAMMATE_ROLE_ID,
    provider: execution.provider,
    model: execution.model,
    profile: profileId,
    configuration,
    ...(execution.reasoning_effort
      ? { reasoningEffort: execution.reasoning_effort }
      : {}),
    options: execution.options ?? {},
    rolePrompt: `${agent.systemPrompt}\n\n${professional}`,
    rolePath: path.resolve(input.cwd, rolePath),
    professionalRolePath: path.resolve(input.cwd, professionalRolePath),
    roleDigest: crypto
      .createHash("sha256")
      .update(common)
      .update("\0")
      .update(professional)
      .digest("hex"),
    profilePath: path.resolve(input.cwd, TEAMMATE_PROFILES_PATH),
    profileDigest: crypto.createHash("sha256").update(raw).digest("hex"),
  };
}
