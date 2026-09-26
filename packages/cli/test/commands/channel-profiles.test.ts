import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveSubnodeProfile } from "../../src/commands/channel/profiles.js";

const tempRoots: string[] = [];

function project(profile = '{"reasoning_effort":"high"}'): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-profile-"));
  tempRoots.push(cwd);
  const agents = path.join(cwd, ".trellis", "agents");
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(
    path.join(agents, "subnode-profiles.json"),
    JSON.stringify({
      default_model: "gpt-6-sol",
      profiles: { review: JSON.parse(profile) },
    }),
  );
  return cwd;
}

afterEach(() => {
  for (const root of tempRoots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("subnode profile resolution", () => {
  it("applies explicit model and effort over the selected profile", () => {
    const resolved = resolveSubnodeProfile({
      cwd: project(),
      agent: "subnode",
      provider: "codex",
      agentModel: "agent-model",
      model: "explicit-model",
      profile: "review",
      reasoningEffort: "xhigh",
      reasoningEffortReason: "cross-owner race review",
    });
    expect(resolved).toMatchObject({
      profile: "review",
      model: "explicit-model",
      modelSource: "explicit",
      reasoningEffort: "xhigh",
      reasoningEffortSource: "explicit",
      reasoningEffortReason: "cross-owner race review",
      profileConfigPath: ".trellis/agents/subnode-profiles.json",
    });
    expect(resolved.profileConfigDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses updated project profile data for each new dispatch", () => {
    const cwd = project();
    const first = resolveSubnodeProfile({
      cwd,
      agent: "subnode",
      provider: "codex",
      profile: "review",
    });
    fs.writeFileSync(
      path.join(cwd, ".trellis", "agents", "subnode-profiles.json"),
      JSON.stringify({
        default_model: "gpt-5.6-terra",
        profiles: { review: { reasoning_effort: "medium" } },
      }),
    );
    const second = resolveSubnodeProfile({
      cwd,
      agent: "subnode",
      provider: "codex",
      profile: "review",
    });

    expect(first).toMatchObject({
      model: "gpt-6-sol",
      reasoningEffort: "high",
    });
    expect(second).toMatchObject({
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
    });
    expect(second.profileConfigDigest).not.toBe(first.profileConfigDigest);
  });

  it("rejects xhigh without a reason and non-Codex profiles", () => {
    expect(() =>
      resolveSubnodeProfile({
        cwd: project('{"reasoning_effort":"xhigh"}'),
        agent: "subnode",
        provider: "codex",
        profile: "review",
      }),
    ).toThrow(/xhigh.*reason/);
    expect(() =>
      resolveSubnodeProfile({
        cwd: project(),
        agent: "subnode",
        provider: "claude",
        profile: "review",
      }),
    ).toThrow(/Codex/);
  });

  it("does not resolve inherited object keys as configured profiles", () => {
    expect(() =>
      resolveSubnodeProfile({
        cwd: project(),
        agent: "subnode",
        provider: "codex",
        profile: "constructor",
      }),
    ).toThrow(/unknown profile/);
  });

  it("rejects an empty explicit model instead of silently falling back", () => {
    expect(() =>
      resolveSubnodeProfile({
        cwd: project(),
        agent: "subnode",
        provider: "codex",
        profile: "review",
        model: " ",
      }),
    ).toThrow(/--model must be a non-empty string/);
  });

  it("keeps unprofiled agent model behavior", () => {
    expect(
      resolveSubnodeProfile({
        cwd: project(),
        agent: "subnode",
        provider: "codex",
        agentModel: "agent-model",
      }),
    ).toMatchObject({ model: "agent-model", modelSource: "agent" });
  });
});
