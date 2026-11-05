import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { assembleContext } from "./context-loader.js";
import { buildTeamworkInstructions } from "./prompt.js";
import {
  assertTeammateHostCapability,
  getTeammateAdapter,
  type TeammateAdapterContract,
  type TeammateHostCapabilities,
} from "./teammate-adapters.js";
import {
  frozenProfileSchema,
  type ResolvedTeammateProfile,
} from "./profiles.js";

/** Role obligations frozen with the launch, not filesystem or Git isolation. */
export interface TeammateWritePolicy {
  protectedTargets: "read-only";
  gitState: "read-only";
  attemptArtifacts: "write-only";
  nativeDelegation: "disabled";
  recursiveDelegation: "disabled";
}

export interface TeammateCapabilitySnapshot {
  /** Static adapter contract, not a successful probe of the installed backend. */
  evidence?: "adapter-contract";
  transport: TeammateAdapterContract["transport"];
  supportsContinuation: true;
  supportsInterrupt: true;
  supportsCancel: true;
  supportsTerminal: true;
  supportsFailure: true;
  writePolicy: TeammateWritePolicy;
  protectedTargets: string[];
  hostProof: {
    foregroundWait: true;
    protectedArtifactWrites: true;
    attemptArtifactWrites: true;
    providerTransports: TeammateHostCapabilities["providerTransports"];
    providerOptions: Partial<TeammateHostCapabilities["providerOptions"]>;
    verifiedHostCap: number;
  };
  digest: string;
}

export interface TeammateLaunchSpec {
  /** Absent on historical frozen plans. */
  reportVersion?: 2;
  roleId: "teammate";
  provider: ResolvedTeammateProfile["provider"];
  profile?: string;
  configuration: string;
  model?: string;
  reasoningEffort?: ResolvedTeammateProfile["reasoningEffort"];
  options: ResolvedTeammateProfile["options"];
  profileDigest?: string;
  prompt: string;
  instructions: string;
  context: string;
  rolePath: string;
  contextPaths: string[];
  contextManifests: string[];
  roleDigest: string;
  contextDigest: string;
  capability: TeammateCapabilitySnapshot;
}

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const frozenLaunchSchema = z
  .object({
    reportVersion: z.literal(2).optional(),
    roleId: z.literal("teammate"),
    provider: frozenProfileSchema.shape.provider,
    profile: z.string().optional(),
    configuration: frozenProfileSchema.shape.configuration,
    model: z.string().optional(),
    reasoningEffort: frozenProfileSchema.shape.reasoningEffort,
    options: frozenProfileSchema.shape.options,
    profileDigest: sha256.optional(),
    prompt: z.string().max(256 * 1024),
    instructions: z
      .string()
      .min(1)
      .max(128 * 1024),
    context: z.string().max(128 * 1024),
    rolePath: z.string(),
    contextPaths: z.array(z.string()),
    contextManifests: z.array(z.string()),
    roleDigest: sha256,
    contextDigest: sha256,
    capability: z
      .object({
        evidence: z.literal("adapter-contract").optional(),
        transport: z.enum(["claude-cli", "codex-app-server", "acp"]),
        supportsContinuation: z.literal(true),
        supportsInterrupt: z.literal(true),
        supportsCancel: z.literal(true),
        supportsTerminal: z.literal(true),
        supportsFailure: z.literal(true),
        writePolicy: z
          .object({
            protectedTargets: z.literal("read-only"),
            gitState: z.literal("read-only"),
            attemptArtifacts: z.literal("write-only"),
            nativeDelegation: z.literal("disabled"),
            recursiveDelegation: z.literal("disabled"),
          })
          .strict(),
        protectedTargets: z.array(z.string()),
        hostProof: z
          .object({
            foregroundWait: z.literal(true),
            protectedArtifactWrites: z.literal(true),
            attemptArtifactWrites: z.literal(true),
            providerTransports: z.array(
              z.enum(["claude-cli", "codex-app-server", "acp"]),
            ),
            providerOptions: z.record(z.string(), z.array(z.string())),
            verifiedHostCap: z.number().int().positive(),
          })
          .strict(),
        digest: sha256,
      })
      .strict(),
  })
  .strict();

export function parseFrozenTeammate(input: unknown): {
  profile: ResolvedTeammateProfile;
  launch: TeammateLaunchSpec;
} {
  const result = z
    .object({ profile: frozenProfileSchema, launch: frozenLaunchSchema })
    .strict()
    .parse(input);
  const { profile, launch } = result;
  for (const field of [
    "provider",
    "model",
    "profile",
    "configuration",
    "reasoningEffort",
    "profileDigest",
    "roleDigest",
  ] as const)
    if (profile[field] !== launch[field])
      throw new Error(`frozen execution ${field} does not match profile`);
  if (
    canonical(profile.options) !== canonical(launch.options) ||
    (launch.reportVersion === 2
      ? buildTeamworkInstructions(profile.rolePrompt, "batch")
      : profile.rolePrompt) !== launch.instructions
  )
    throw new Error(
      "frozen execution instructions or options do not match profile",
    );
  const { digest: expected, ...capability } = launch.capability;
  if (hash(canonical(capability)) !== expected)
    throw new Error("frozen capability digest does not match");
  return result;
}

function hash(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requireRegularFile(
  cwd: string,
  candidate: string,
  field: string,
): string {
  const root = path.resolve(cwd);
  const resolved = path.resolve(root, candidate);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(`${field} must stay within the project root: ${candidate}`);
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current))
      throw new Error(`${field} is missing: ${candidate}`);
    if (fs.lstatSync(current).isSymbolicLink())
      throw new Error(`${field} must not contain symlinks: ${candidate}`);
  }
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile())
    throw new Error(`${field} must be a regular file: ${candidate}`);
  return resolved;
}

function assertReturnedPath(
  paths: string[],
  cwd: string,
  requested: string,
  field: string,
): void {
  const normalized = path.relative(cwd, path.resolve(cwd, requested));
  if (!paths.includes(normalized))
    throw new Error(
      `${field} was not injected into the teammate context: ${requested}`,
    );
}

export function buildTeammateLaunchSpec(input: {
  cwd: string;
  profile: ResolvedTeammateProfile;
  host: TeammateHostCapabilities;
  contextFiles?: string[];
  contextManifests?: string[];
  protectedTargets?: readonly string[];
}): TeammateLaunchSpec {
  const adapter = getTeammateAdapter(input.profile.provider);
  assertTeammateHostCapability(
    input.profile.provider,
    input.host,
    input.profile.options,
  );
  const contextFiles = input.contextFiles ?? [];
  const contextManifests = input.contextManifests ?? [];
  for (const file of contextFiles)
    requireRegularFile(input.cwd, file, "teammate context file");
  for (const manifest of contextManifests)
    requireRegularFile(input.cwd, manifest, "teammate context manifest");

  const assembled = assembleContext(input.cwd, contextFiles, contextManifests);
  for (const file of contextFiles)
    assertReturnedPath(
      assembled.paths,
      input.cwd,
      file,
      "teammate context file",
    );
  for (const manifest of contextManifests) {
    const normalized = path.relative(
      input.cwd,
      path.resolve(input.cwd, manifest),
    );
    if (!assembled.manifests.includes(normalized))
      throw new Error(
        `teammate context manifest was not recorded: ${manifest}`,
      );
  }

  const roleDigest = input.profile.roleDigest;
  const contextDigest = hash(
    assembled.paths
      .map(
        (filePath) =>
          `${filePath}\0${fs.readFileSync(path.resolve(input.cwd, filePath), "utf8")}`,
      )
      .concat(
        assembled.manifests.map(
          (manifest) =>
            `manifest\0${manifest}\0${fs.readFileSync(path.resolve(input.cwd, manifest), "utf8")}`,
        ),
      )
      .join("\0"),
  );
  const writePolicy: TeammateWritePolicy = {
    protectedTargets: "read-only",
    gitState: "read-only",
    attemptArtifacts: "write-only",
    nativeDelegation: "disabled",
    recursiveDelegation: "disabled",
  };
  const capability = {
    evidence: "adapter-contract" as const,
    transport: adapter.transport,
    supportsContinuation: true as const,
    supportsInterrupt: true as const,
    supportsCancel: true as const,
    supportsTerminal: true as const,
    supportsFailure: true as const,
    writePolicy,
    protectedTargets: [...(input.protectedTargets ?? [])].sort(),
    hostProof: {
      foregroundWait: true as const,
      protectedArtifactWrites: true as const,
      attemptArtifactWrites: true as const,
      providerTransports: [...input.host.providerTransports].sort(),
      providerOptions: Object.fromEntries(
        Object.entries(input.host.providerOptions).map(
          ([provider, options]) => [provider, [...(options ?? [])].sort()],
        ),
      ),
      verifiedHostCap: input.host.verifiedHostCap,
    },
  };
  const capabilitySnapshot: TeammateCapabilitySnapshot = {
    ...capability,
    digest: hash(canonical(capability)),
  };
  return {
    roleId: "teammate",
    reportVersion: 2,
    configuration: input.profile.configuration,
    provider: input.profile.provider,
    ...(input.profile.profile ? { profile: input.profile.profile } : {}),
    ...(input.profile.model ? { model: input.profile.model } : {}),
    ...(input.profile.reasoningEffort
      ? { reasoningEffort: input.profile.reasoningEffort }
      : {}),
    options: input.profile.options,
    ...(input.profile.profileDigest
      ? { profileDigest: input.profile.profileDigest }
      : {}),
    prompt: [
      buildTeamworkInstructions(input.profile.rolePrompt, "batch"),
      assembled.prompt,
    ]
      .filter(Boolean)
      .join("\n\n---\n\n"),
    instructions: buildTeamworkInstructions(input.profile.rolePrompt, "batch"),
    context: assembled.prompt,
    rolePath: input.profile.rolePath,
    contextPaths: assembled.paths,
    contextManifests: assembled.manifests,
    roleDigest,
    contextDigest,
    capability: capabilitySnapshot,
  };
}

/** Frozen references must still name the same bytes when read by a worker. */
export function assertTeammateContextCurrent(
  launch: TeammateLaunchSpec,
  cwd: string,
): void {
  if (launch.reportVersion !== 2) return;
  const actual = hash(
    launch.contextPaths
      .map(
        (file) =>
          `${file}\0${fs.readFileSync(requireRegularFile(cwd, file, "teammate context file"), "utf8")}`,
      )
      .concat(
        launch.contextManifests.map(
          (manifest) =>
            `manifest\0${manifest}\0${fs.readFileSync(requireRegularFile(cwd, manifest, "teammate context manifest"), "utf8")}`,
        ),
      )
      .join("\0"),
  );
  if (actual !== launch.contextDigest)
    throw new Error(
      "Frozen teammate context changed; construct a new plan before dispatch",
    );
}
