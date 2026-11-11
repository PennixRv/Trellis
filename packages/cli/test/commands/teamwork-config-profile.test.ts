import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  effectiveTeammateCapacity,
  resolveTeammateRuntimeConfig,
} from "../../src/commands/teamwork/teammate-config.js";
import { resolveTeammateProfile } from "../../src/commands/teamwork/profiles.js";
import { installTeammateAssets } from "../helpers/teammate-assets.js";
import { createTeamworkSession } from "../../src/commands/teamwork/create.js";
import { teamworkSessionSpawn } from "../../src/commands/teamwork/spawn.js";

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-profile-test-"));
  installTeammateAssets(root);
  fs.mkdirSync(path.join(root, ".trellis", "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".trellis", "agents", "teammate.md"),
    "---\nname: teammate\n---\nReview only the assigned evidence.\n",
  );
  fs.writeFileSync(
    path.join(root, ".trellis", "agents", "teammate-profiles.json"),
    JSON.stringify({
      schema_version: 2,
      default_profile: "review",
      profiles: {
        review: {
          role: "profiles/review.md",
          default_configuration: "primary",
          configurations: {
            primary: {
              provider: "claude",
              model: "claude-review",
              reasoning_effort: "high",
              options: { temperature: 0, mode: "review" },
            },
            alternative: { provider: "codex", model: "other" },
          },
        },
      },
    }),
  );
  fs.writeFileSync(
    path.join(root, ".trellis", "config.yaml"),
    "teamwork:\n  teammate:\n    max_concurrency: 3\n  teammate_guard:\n    max_live_teammates: 4\n    non_batch_reserved: 1\n",
  );
  fs.writeFileSync(
    path.join(root, ".trellis/teamwork.json"),
    JSON.stringify({
      schema_version: 1,
      default_mode: "general",
      modes: {
        general: { default_members: 1 },
        advisor: { default_members: 1 },
        committee: { default_members: 3 },
      },
    }),
  );
  return root;
}

describe("TeamworkSession teammate config and profiles", () => {
  it("rejects unsupported interactive options before creating a supervisor", async () => {
    const root = project();
    const previousRoot = process.env.TRELLIS_TEAMWORK_ROOT;
    const previousProject = process.env.TRELLIS_TEAMWORK_PROJECT;
    process.env.TRELLIS_TEAMWORK_ROOT = path.join(root, "sessions");
    process.env.TRELLIS_TEAMWORK_PROJECT = "fixture";
    try {
      await createTeamworkSession("unsupported-options", { by: "main" });
      await expect(
        teamworkSessionSpawn("unsupported-options", {
          cwd: root,
          profile: "review",
        }),
      ).rejects.toThrow(/unsupported options: temperature, mode/);
      const session = path.join(
        root,
        "sessions",
        "fixture",
        "unsupported-options",
      );
      expect(
        fs.readdirSync(session).some((name) => name.endsWith(".pid")),
      ).toBe(false);
    } finally {
      if (previousRoot === undefined) delete process.env.TRELLIS_TEAMWORK_ROOT;
      else process.env.TRELLIS_TEAMWORK_ROOT = previousRoot;
      if (previousProject === undefined)
        delete process.env.TRELLIS_TEAMWORK_PROJECT;
      else process.env.TRELLIS_TEAMWORK_PROJECT = previousProject;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves one role, provider, model, profile and bounded options", () => {
    const root = project();
    const resolved = resolveTeammateProfile({ cwd: root, profile: "review" });
    expect(resolved).toMatchObject({
      roleId: "teammate",
      provider: "claude",
      model: "claude-review",
      profile: "review",
      reasoningEffort: "high",
      options: { temperature: 0, mode: "review" },
    });
    expect(resolved.rolePrompt).toContain("assigned evidence");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("loads project capacity and rejects an explicit request above the guard", () => {
    const root = project();
    const config = resolveTeammateRuntimeConfig(root, {});
    expect(config).toMatchObject({
      teammate: { maxConcurrency: 3 },
      guard: { maxLiveTeammates: 4, nonBatchReserved: 1 },
    });
    expect(
      effectiveTeammateCapacity({ requested: 3, config, verifiedHostCap: 3 }),
    ).toBe(3);
    expect(() =>
      effectiveTeammateCapacity({ requested: 4, config, verifiedHostCap: 4 }),
    ).toThrow(/exceeds verified limit/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("does not read the retired sessionId teammate configuration", () => {
    const root = project();
    fs.writeFileSync(
      path.join(root, ".trellis", "config.yaml"),
      "sessionId:\n  teammate:\n    max_concurrency: 3\n  teammate_guard:\n    max_live_teammates: 4\n    non_batch_reserved: 1\n",
    );
    expect(resolveTeammateRuntimeConfig(root, {}).teammate.maxConcurrency).toBe(
      8,
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects non-finite profile option numbers", () => {
    const root = project();
    fs.writeFileSync(
      path.join(root, ".trellis", "agents", "teammate-profiles.json"),
      '{"schema_version":2,"default_profile":"review","profiles":{"review":{"role":"profiles/review.md","default_configuration":"a","configurations":{"a":{"provider":"codex","model":"m","options":{"temperature":1e400}},"b":{"provider":"copilot","model":"m"}}}}}',
    );
    expect(() =>
      resolveTeammateProfile({ cwd: root, profile: "review" }),
    ).toThrow(/Infinity|number/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
