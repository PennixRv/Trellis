import crypto from "node:crypto";

import { z } from "zod";

import { readTeamworkAsset } from "./profiles.js";

export const COORDINATION_MODES = ["general", "advisor", "committee"] as const;
export type CoordinationMode = (typeof COORDINATION_MODES)[number];
export const TEAMWORK_CONFIG_PATH = ".trellis/teamwork.json";

const configSchema = z
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

export function resolveCoordination(
  cwd: string,
  mode?: CoordinationMode,
): {
  mode: CoordinationMode;
  defaultMembers: number;
  configDigest: string;
} {
  const raw = readTeamworkAsset(cwd, TEAMWORK_CONFIG_PATH);
  const config = configSchema.parse(JSON.parse(raw));
  const selected = mode ?? config.default_mode;
  return {
    mode: selected,
    defaultMembers: config.modes[selected].default_members,
    configDigest: crypto.createHash("sha256").update(raw).digest("hex"),
  };
}

export function assertCoordinationMembers(
  mode: CoordinationMode,
  members: readonly { lens?: string }[],
): void {
  if (members.length === 0)
    throw new Error("Teamwork requires at least one assignment");
  if (mode === "advisor" && members.length !== 1)
    throw new Error("advisor requires exactly one assignment");
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
