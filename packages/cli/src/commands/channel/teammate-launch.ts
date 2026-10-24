import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { assembleContext } from "./context-loader.js";
import {
  assertTeammateHostCapability,
  getTeammateAdapter,
  type TeammateAdapterContract,
  type TeammateHostCapabilities,
} from "./teammate-adapters.js";
import type { ResolvedTeammateProfile } from "./profiles.js";

export interface TeammateWritePolicy {
  protectedTargets: "read-only";
  gitState: "read-only";
  attemptArtifacts: "write-only";
  nativeDelegation: "disabled";
  recursiveDelegation: "disabled";
}

export interface TeammateCapabilitySnapshot {
  transport: TeammateAdapterContract["transport"];
  nativeDelegationDisabled: true;
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
    protectedTargetsReadOnly: true;
    gitStateReadOnly: true;
    attemptArtifactWrites: true;
    nativeDelegationDisabled: true;
    implicitMemoryDisabled: true;
    providerTransports: TeammateHostCapabilities["providerTransports"];
    providerOptions: Partial<TeammateHostCapabilities["providerOptions"]>;
    verifiedHostCap: number;
  };
  digest: string;
}

export interface TeammateLaunchSpec {
  roleId: "teammate";
  provider: ResolvedTeammateProfile["provider"];
  profile?: string;
  model?: string;
  reasoningEffort?: ResolvedTeammateProfile["reasoningEffort"];
  options: ResolvedTeammateProfile["options"];
  profileDigest?: string;
  prompt: string;
  rolePath: string;
  contextPaths: string[];
  contextManifests: string[];
  roleDigest: string;
  contextDigest: string;
  capability: TeammateCapabilitySnapshot;
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

  const roleFile = requireRegularFile(
    input.cwd,
    input.profile.rolePath,
    "teammate role",
  );
  const roleBytes = fs.readFileSync(roleFile);
  const roleDigest = hash(roleBytes);
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
    transport: adapter.transport,
    nativeDelegationDisabled: true as const,
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
      protectedTargetsReadOnly: true as const,
      gitStateReadOnly: true as const,
      attemptArtifactWrites: true as const,
      nativeDelegationDisabled: true as const,
      implicitMemoryDisabled: true as const,
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
    prompt: [input.profile.rolePrompt, assembled.prompt]
      .filter(Boolean)
      .join("\n\n---\n\n"),
    rolePath: input.profile.rolePath,
    contextPaths: assembled.paths,
    contextManifests: assembled.manifests,
    roleDigest,
    contextDigest,
    capability: capabilitySnapshot,
  };
}
