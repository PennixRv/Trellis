import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertTeammateAdapterContract,
  assertTeammateHostCapability,
  getTeammateAdapter,
  listTeammateProviders,
} from "../../src/commands/teamwork/teammate-adapters.js";
import { registerTeamworkCommand } from "../../src/commands/teamwork/index.js";
import { resolveTeammateProfile } from "../../src/commands/teamwork/profiles.js";
import {
  assertTeammateContextCurrent,
  buildTeammateLaunchSpec,
  parseFrozenTeammate,
} from "../../src/commands/teamwork/teammate-launch.js";
import { installTeammateAssets } from "../helpers/teammate-assets.js";

const host = {
  foregroundWait: true,
  protectedArtifactWrites: true,
  attemptArtifactWrites: true,
  providerTransports: ["codex-app-server" as const],
  providerOptions: { codex: ["temperature"] },
  verifiedHostCap: 2,
};

function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-launch-test-"));
  installTeammateAssets(cwd);
  fs.mkdirSync(path.join(cwd, ".trellis", "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".trellis", "agents", "teammate.md"),
    "---\nname: teammate\n---\nReview the assigned evidence.\n",
  );
  fs.writeFileSync(path.join(cwd, "evidence.md"), "Original evidence.\n");
  fs.writeFileSync(
    path.join(cwd, "context.jsonl"),
    '{"file":"evidence.md","reason":"assigned source"}\n',
  );
  fs.writeFileSync(
    path.join(cwd, ".trellis", "agents", "teammate-profiles.json"),
    JSON.stringify({
      schema_version: 2,
      default_profile: "review",
      profiles: {
        review: {
          role: "profiles/review.md",
          default_configuration: "a",
          configurations: {
            a: { provider: "codex", model: "m", options: { temperature: 0 } },
            b: { provider: "copilot", model: "m" },
          },
        },
      },
    }),
  );
  return cwd;
}

describe("teammate adapter contract", () => {
  afterEach(() => vi.restoreAllMocks());

  it("registers the four provider lifecycle transports", () => {
    expect(listTeammateProviders().sort()).toEqual([
      "claude",
      "codex",
      "copilot",
      "dsh",
    ]);
    for (const provider of listTeammateProviders()) {
      expect(() => assertTeammateAdapterContract(provider)).not.toThrow();
    }
  });

  it("gets executable transports from the runtime registry", () => {
    expect(getTeammateAdapter("copilot").transport).toBe("acp");
    expect(getTeammateAdapter("codex").transport).toBe("codex-app-server");
  });

  it("fails closed when the host cannot prove the required boundary", () => {
    expect(() =>
      assertTeammateHostCapability("codex", {
        foregroundWait: false,
        protectedArtifactWrites: true,
        attemptArtifactWrites: true,
        providerTransports: ["codex-app-server"],
        providerOptions: { codex: [] },
        verifiedHostCap: 2,
      }),
    ).toThrow(/capability proof/);

    expect(() =>
      assertTeammateHostCapability("dsh", {
        foregroundWait: true,
        protectedArtifactWrites: true,
        attemptArtifactWrites: true,
        providerTransports: ["codex-app-server"],
        providerOptions: { dsh: [] },
        verifiedHostCap: 2,
      }),
    ).toThrow(/not verified/);
  });

  it("fails closed when the host cannot write attempt artifacts", () => {
    expect(() =>
      assertTeammateHostCapability("codex", {
        ...host,
        attemptArtifactWrites: false,
      }),
    ).toThrow(/capability proof/);

    const missingProof = { ...host } as Partial<typeof host>;
    delete missingProof.attemptArtifactWrites;
    expect(() =>
      assertTeammateHostCapability("codex", missingProof as typeof host),
    ).toThrow(/capability proof/);
  });

  it("uses role policy for source and Git writes without claiming host isolation", () => {
    const cwd = project();
    try {
      const roleOnlyHost = {
        ...host,
        protectedTargetsReadOnly: false,
        gitStateReadOnly: false,
      };
      const profile = resolveTeammateProfile({ cwd, provider: "codex" });
      const launch = buildTeammateLaunchSpec({
        cwd,
        profile,
        host: roleOnlyHost,
      });
      expect(launch.capability.writePolicy).toMatchObject({
        protectedTargets: "read-only",
        gitState: "read-only",
      });
      expect(launch.capability.hostProof).not.toHaveProperty(
        "protectedTargetsReadOnly",
      );
      expect(launch.capability.hostProof).not.toHaveProperty(
        "gitStateReadOnly",
      );
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("freezes injected role, context, profile and host capability digests", () => {
    const cwd = project();
    const profile = resolveTeammateProfile({
      cwd,
      profile: "review",
      provider: "codex",
    });
    const launch = buildTeammateLaunchSpec({
      cwd,
      profile,
      host,
      contextManifests: ["context.jsonl"],
      protectedTargets: ["src", ".trellis/config.yaml"],
    });
    expect(launch.prompt).toContain("Review the assigned evidence.");
    expect(launch.prompt).toContain("Original evidence.");
    expect(launch.profileDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(launch.contextDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(launch.capability).toMatchObject({
      transport: "codex-app-server",
      protectedTargets: [".trellis/config.yaml", "src"],
      hostProof: {
        verifiedHostCap: 2,
      },
    });
    const originalDigest = launch.contextDigest;
    expect(launch.capability.evidence).toBe("adapter-contract");
    expect(() => assertTeammateContextCurrent(launch, cwd)).not.toThrow();
    fs.writeFileSync(path.join(cwd, "evidence.md"), "Changed evidence.\n");
    expect(() => assertTeammateContextCurrent(launch, cwd)).toThrow(
      /context changed/,
    );
    const changed = buildTeammateLaunchSpec({ cwd, profile, host });
    expect(changed.contextDigest).not.toBe(originalDigest);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it.each(["required", "on-demand"])(
    "freezes %s references without inlining their body",
    (delivery) => {
      const cwd = project();
      try {
        fs.writeFileSync(
          path.join(cwd, "context.jsonl"),
          JSON.stringify({
            file: "evidence.md",
            reason: "assigned source",
            delivery,
          }),
        );
        const profile = resolveTeammateProfile({ cwd });
        const launch = buildTeammateLaunchSpec({
          cwd,
          profile,
          host,
          contextManifests: ["context.jsonl"],
        });
        expect(launch.context).toContain("evidence.md");
        expect(launch.context).toContain(delivery);
        expect(launch.context).not.toContain("Original evidence.");
        expect(() => assertTeammateContextCurrent(launch, cwd)).not.toThrow();
        fs.rmSync(path.join(cwd, "evidence.md"));
        expect(() => assertTeammateContextCurrent(launch, cwd)).toThrow(
          /missing/,
        );
        expect(() =>
          buildTeammateLaunchSpec({
            cwd,
            profile,
            host,
            contextManifests: ["context.jsonl"],
          }),
        ).toThrow();
      } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    },
  );

  it("reads a historical frozen launch without imposing the new report contract", () => {
    const cwd = project();
    try {
      const profile = resolveTeammateProfile({ cwd });
      const launch = buildTeammateLaunchSpec({ cwd, profile, host });
      delete launch.reportVersion;
      launch.instructions = profile.rolePrompt;
      launch.prompt = profile.rolePrompt;
      expect(
        parseFrozenTeammate({ profile, launch }).launch.reportVersion,
      ).toBeUndefined();
      expect(() => assertTeammateContextCurrent(launch, cwd)).not.toThrow();
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects missing or symlinked context and unsupported profile options", () => {
    const cwd = project();
    const profile = resolveTeammateProfile({
      cwd,
      profile: "review",
      provider: "codex",
    });
    expect(() =>
      buildTeammateLaunchSpec({
        cwd,
        profile,
        host,
        contextFiles: ["missing.md"],
      }),
    ).toThrow(/missing/);
    const outside = path.join(os.tmpdir(), `outside-${process.pid}.md`);
    fs.writeFileSync(outside, "outside\n");
    fs.symlinkSync(outside, path.join(cwd, "linked.md"));
    expect(() =>
      buildTeammateLaunchSpec({
        cwd,
        profile,
        host,
        contextFiles: ["linked.md"],
      }),
    ).toThrow(/symlink/);
    expect(() =>
      buildTeammateLaunchSpec({
        cwd,
        profile,
        host: { ...host, providerOptions: { codex: [] } },
      }),
    ).toThrow(/unsupported options/);
    fs.rmSync(outside, { force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("refuses the batch entrypoint before reading a plan without a verified host", async () => {
    const program = new Command();
    registerTeamworkCommand(program);
    expect(program.commands.map((command) => command.name())).toContain(
      "teamwork",
    );
    expect(program.commands.map((command) => command.name())).not.toContain(
      "sessionId",
    );
    const exit = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      program.parseAsync([
        "node",
        "trellis",
        "teamwork",
        "batch",
        "missing-plan.json",
        "--task",
        ".trellis/tasks/missing",
      ]),
    ).rejects.toThrow("process.exit(1)");
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("ENOENT"),
    );
  });
});
