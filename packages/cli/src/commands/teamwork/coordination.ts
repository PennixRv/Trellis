import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { readTeamworkAsset } from "./profiles.js";

export const COORDINATION_MODES = ["general", "advisor", "committee"] as const;
export type CoordinationMode = (typeof COORDINATION_MODES)[number];
export const TEAMWORK_CONFIG_PATH = ".trellis/teamwork.json";

const legacySchema = z
  .object({
    schema_version: z.literal(1),
    default_mode: z.enum(COORDINATION_MODES),
    modes: z
      .object({
        general: z
          .object({ default_members: z.number().int().min(1).max(32) })
          .strict(),
        advisor: z.object({ default_members: z.literal(1) }).strict(),
        committee: z
          .object({ default_members: z.number().int().min(2).max(3) })
          .strict(),
      })
      .strict(),
  })
  .strict();

const modeSchema = (
  min: number,
  max: number,
): z.ZodType<{ default_members: number; max_concurrency: number }> =>
  z
    .object({
      default_members: z.number().int().min(min).max(max),
      max_concurrency: z.number().int().positive().max(32),
    })
    .strict();
const configSchema = z
  .object({
    schema_version: z.literal(2),
    default_mode: z.enum(COORDINATION_MODES),
    modes: z
      .object({
        general: modeSchema(1, 32),
        advisor: modeSchema(1, 3),
        committee: modeSchema(2, 3),
      })
      .strict(),
    resources: z
      .object({
        max_live_teammates: z.number().int().positive(),
        non_batch_reserved: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (c) => c.resources.non_batch_reserved < c.resources.max_live_teammates,
    "reserved capacity must be below the live budget",
  );

export const DEFAULT_TEAMWORK_CONFIG = {
  schema_version: 2 as const,
  default_mode: "general" as const,
  modes: {
    general: { default_members: 1, max_concurrency: 8 },
    advisor: { default_members: 3, max_concurrency: 3 },
    committee: { default_members: 3, max_concurrency: 3 },
  },
  resources: { max_live_teammates: 8, non_batch_reserved: 0 },
};

export function readCoordinationConfig(cwd: string): {
  config: z.infer<typeof configSchema>;
  legacy: boolean;
  configDigest: string;
  source: string;
} {
  const file = path.join(cwd, TEAMWORK_CONFIG_PATH);
  const exists = fs.existsSync(file);
  const raw = exists
    ? readTeamworkAsset(cwd, TEAMWORK_CONFIG_PATH)
    : JSON.stringify(DEFAULT_TEAMWORK_CONFIG);
  const input = JSON.parse(raw) as { schema_version?: number };
  const legacy = input.schema_version === 1;
  const config = legacy
    ? (() => {
        const old = legacySchema.parse(input);
        return {
          ...DEFAULT_TEAMWORK_CONFIG,
          default_mode: old.default_mode,
          modes: {
            general: {
              ...DEFAULT_TEAMWORK_CONFIG.modes.general,
              default_members: old.modes.general.default_members,
            },
            advisor: {
              ...DEFAULT_TEAMWORK_CONFIG.modes.advisor,
              default_members: old.modes.advisor.default_members,
            },
            committee: {
              ...DEFAULT_TEAMWORK_CONFIG.modes.committee,
              default_members: old.modes.committee.default_members,
            },
          },
        };
      })()
    : configSchema.parse(input);
  return {
    config,
    legacy: legacy || !exists,
    configDigest: crypto.createHash("sha256").update(raw).digest("hex"),
    source: exists ? TEAMWORK_CONFIG_PATH : "built-in",
  };
}

export function resolveCoordination(
  cwd: string,
  mode?: CoordinationMode,
): {
  mode: CoordinationMode;
  defaultMembers: number;
  maxConcurrency: number;
  configDigest: string;
} {
  const { config, configDigest } = readCoordinationConfig(cwd);
  const selected = mode ?? config.default_mode;
  return {
    mode: selected,
    defaultMembers: config.modes[selected].default_members,
    maxConcurrency: config.modes[selected].max_concurrency,
    configDigest,
  };
}

export function assertCoordinationMembers(
  mode: CoordinationMode,
  members: readonly { lens?: string }[],
): void {
  if (members.length === 0)
    throw new Error("Teamwork requires at least one assignment");
  if (mode === "advisor" && members.length > 3)
    throw new Error("advisor requires one to three assignments");
  if (mode === "committee") {
    if (members.length < 2 || members.length > 3)
      throw new Error("committee requires two or three assignments");
    const lenses = members.map((member) => member.lens?.trim());
    if (lenses.some((lens) => !lens) || new Set(lenses).size !== members.length)
      throw new Error(
        "committee requires distinct lenses (本次关注点), each nonempty",
      );
  }
}
