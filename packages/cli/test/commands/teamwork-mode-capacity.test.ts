import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTeammateAssets } from "../helpers/teammate-assets.js";
import {
  resolveCoordination,
  assertFrozenCoordination,
} from "../../src/commands/teamwork/coordination.js";
import {
  resolveTeammateRuntimeConfig,
  effectiveTeammateCapacity,
} from "../../src/commands/teamwork/teammate-config.js";
import { resolveTeammateGuardConfig } from "../../src/commands/teamwork/guard.js";

describe("unified mode capacity policy", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-capacity-"));
    installTeammateAssets(cwd);
  });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));
  it.each([
    ["general", 1, 8],
    ["advisor", 3, 3],
    ["committee", 3, 3],
  ] as const)(
    "resolves %s independently of member count",
    (mode, members, capacity) => {
      expect(resolveCoordination(cwd, mode)).toMatchObject({
        defaultMembers: members,
        maxConcurrency: capacity,
      });
      const config = resolveTeammateRuntimeConfig(cwd, {}, mode);
      expect(effectiveTeammateCapacity({ config, verifiedHostCap: 32 })).toBe(
        capacity,
      );
      expect(config.guard.maxLiveTeammates).toBe(8);
    },
  );
  it("does not silently let legacy YAML cap a schema-2 project", () => {
    fs.writeFileSync(
      path.join(cwd, ".trellis/config.yaml"),
      "teamwork:\n  teammate:\n    max_concurrency: 1\n  teammate_guard:\n    max_live_teammates: 6\n",
    );
    const config = resolveTeammateRuntimeConfig(cwd, {});
    expect(config.teammate.maxConcurrency).toBe(8);
    expect(config.diagnostics).toEqual(
      expect.arrayContaining([expect.stringContaining("ignored")]),
    );
    expect(resolveTeammateGuardConfig({ cwd, env: {} }).maxLiveWorkers).toBe(8);
  });

  it("reserves only actual assignments without relaxing explicit policy limits", () => {
    const config = resolveTeammateRuntimeConfig(cwd, {});
    expect(
      effectiveTeammateCapacity({
        config,
        verifiedHostCap: 32,
        assignmentCount: 1,
      }),
    ).toBe(1);
    expect(
      effectiveTeammateCapacity({
        config,
        verifiedHostCap: 32,
        assignmentCount: 12,
      }),
    ).toBe(8);
    expect(() =>
      effectiveTeammateCapacity({
        config,
        verifiedHostCap: 32,
        requested: 9,
        assignmentCount: 1,
      }),
    ).toThrow(/exceeds verified limit/);
  });
  it("shares a configured live budget across interactive and managed entry points", () => {
    const file = path.join(cwd, ".trellis/teamwork.json");
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    json.resources.max_live_teammates = 5;
    json.resources.non_batch_reserved = 1;
    fs.writeFileSync(file, JSON.stringify(json));
    const config = resolveTeammateRuntimeConfig(cwd, {});
    expect(effectiveTeammateCapacity({ config, verifiedHostCap: 32 })).toBe(4);
    expect(resolveTeammateGuardConfig({ cwd, env: {} }).maxLiveWorkers).toBe(5);
    expect(() =>
      effectiveTeammateCapacity({ config, requested: 5, verifiedHostCap: 32 }),
    ).toThrow(/exceeds verified limit/);
  });
  it("keeps explicit environment overrides visible", () => {
    const config = resolveTeammateRuntimeConfig(
      cwd,
      { TRELLIS_TEAMWORK_TEAMMATE_MAX_CONCURRENCY: "2" },
      "general",
    );
    expect(config.teammate.maxConcurrency).toBe(2);
    expect(config.diagnostics?.join(" ")).toContain("explicitly overrides");
  });
  it("uses zero consistently to disable only the shared live budget", () => {
    const file = path.join(cwd, ".trellis/teamwork.json");
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    json.resources.max_live_teammates = 0;
    fs.writeFileSync(file, JSON.stringify(json));
    const config = resolveTeammateRuntimeConfig(cwd, {});
    expect(resolveTeammateGuardConfig({ cwd, env: {} }).maxLiveWorkers).toBe(0);
    expect(
      effectiveTeammateCapacity({
        config,
        verifiedHostCap: 32,
        assignmentCount: 12,
      }),
    ).toBe(8);
    expect(
      effectiveTeammateCapacity({
        config,
        verifiedHostCap: 2,
        assignmentCount: 12,
      }),
    ).toBe(2);
  });
  it("rejects damaged policy rather than falling back", () => {
    fs.writeFileSync(path.join(cwd, ".trellis/teamwork.json"), "{");
    expect(() => resolveTeammateRuntimeConfig(cwd, {})).toThrow();
    expect(() => resolveTeammateGuardConfig({ cwd, env: {} })).toThrow();
  });
  it("rejects environment expansion of the frozen shared budget", () => {
    const frozen = resolveCoordination(cwd);
    expect(() =>
      assertFrozenCoordination(cwd, frozen.configDigest, frozen.snapshot, {
        mode: "general",
        maxConcurrency: 8,
        guard: { maxLiveTeammates: 0, nonBatchReserved: 0 },
      }),
    ).toThrow(/expands frozen/);
    expect(resolveTeammateRuntimeConfig(cwd, {}).sourceDigest).not.toBe(
      resolveTeammateRuntimeConfig(cwd, {
        TRELLIS_TEAMWORK_TEAMMATE_MAX_CONCURRENCY: "2",
      }).sourceDigest,
    );
  });
  it("allows only stricter resource policy after freezing", () => {
    const frozen = resolveCoordination(cwd);
    const file = path.join(cwd, ".trellis/teamwork.json");
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    json.resources.max_live_teammates = 4;
    fs.writeFileSync(file, JSON.stringify(json));
    expect(() =>
      assertFrozenCoordination(cwd, frozen.configDigest, frozen.snapshot),
    ).not.toThrow();
    json.modes.general.default_members = 2;
    fs.writeFileSync(file, JSON.stringify(json));
    expect(() =>
      assertFrozenCoordination(cwd, frozen.configDigest, frozen.snapshot),
    ).toThrow(/construct a new plan/);
    json.modes.general.default_members = 1;
    json.resources.max_live_teammates = 0;
    fs.writeFileSync(file, JSON.stringify(json));
    expect(() =>
      assertFrozenCoordination(cwd, frozen.configDigest, frozen.snapshot),
    ).toThrow(/expanded/);
    expect(() => assertFrozenCoordination(cwd, frozen.configDigest)).toThrow(
      /changed/,
    );
  });
});
