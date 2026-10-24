import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  effectiveTeammateCapacity,
  resolveTeammateRuntimeConfig,
} from "../../src/commands/channel/teammate-config.js";
import { resolveTeammateProfile } from "../../src/commands/channel/profiles.js";

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-profile-test-"));
  fs.mkdirSync(path.join(root, ".trellis", "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".trellis", "agents", "teammate.md"),
    "---\nname: teammate\n---\nReview only the assigned evidence.\n",
  );
  fs.writeFileSync(
    path.join(root, ".trellis", "agents", "teammate-profiles.json"),
    JSON.stringify({
      default_provider: "codex",
      profiles: {
        review: {
          provider: "claude",
          model: "claude-review",
          reasoning_effort: "high",
          options: { temperature: 0, mode: "review" },
        },
      },
    }),
  );
  fs.writeFileSync(
    path.join(root, ".trellis", "config.yaml"),
    "teamwork:\n  teammate:\n    max_concurrency: 3\n  teammate_guard:\n    max_live_teammates: 4\n    non_batch_reserved: 1\n",
  );
  return root;
}

describe("Channel teammate config and profiles", () => {
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

  it("does not read the retired channel teammate configuration", () => {
    const root = project();
    fs.writeFileSync(
      path.join(root, ".trellis", "config.yaml"),
      "channel:\n  teammate:\n    max_concurrency: 3\n  teammate_guard:\n    max_live_teammates: 4\n    non_batch_reserved: 1\n",
    );
    expect(resolveTeammateRuntimeConfig(root, {}).teammate.maxConcurrency).toBe(
      1,
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects non-finite profile option numbers", () => {
    const root = project();
    fs.writeFileSync(
      path.join(root, ".trellis", "agents", "teammate-profiles.json"),
      '{"profiles":{"review":{"options":{"temperature":1e400}}}}',
    );
    expect(() =>
      resolveTeammateProfile({ cwd: root, profile: "review" }),
    ).toThrow(/must be finite/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
