import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init } from "../../src/commands/init.js";
import {
  resolveProjectPolicy,
  preflightProjectInit,
} from "../../src/utils/project-init.js";

const hasCodex =
  spawnSync("codex", ["--version"], { encoding: "utf8" }).status === 0;
let base: string, root: string, home: string;
beforeEach(() => {
  base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "trellis-native-init-")),
  );
  root = path.join(base, 'project "quoted"');
  home = path.join(base, "codex");
  fs.mkdirSync(root);
  fs.mkdirSync(home);
  fs.writeFileSync(
    path.join(home, "config.toml"),
    "[features]\nhooks = true\n",
  );
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.stubEnv("CODEX_HOME", home);
  vi.stubEnv("XDG_CONFIG_HOME", path.join(base, "config"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(base, { recursive: true, force: true });
});

describe("project initialization selection", () => {
  it("rejects relative or in-project CODEX_HOME before starting native writes", async () => {
    vi.stubEnv("CODEX_HOME", ".codex");
    await expect(
      preflightProjectInit(root, { trustCodex: true, codegraph: false }),
    ).rejects.toThrow("CODEX_HOME must be");
    vi.stubEnv("CODEX_HOME", path.join(root, ".codex"));
    await expect(
      preflightProjectInit(root, { trustCodex: true, codegraph: false }),
    ).rejects.toThrow("CODEX_HOME must be");
    expect(fs.readdirSync(root)).toEqual([]);
  });
  it("keeps standalone defaults unselected and respects explicit opt-out", () => {
    expect(resolveProjectPolicy(root, {})).toEqual({
      trustCodex: false,
      codegraph: false,
    });
    expect(
      resolveProjectPolicy(root, { trustCodex: true, codegraph: false }),
    ).toEqual({ trustCodex: true, codegraph: false });
    expect(
      resolveProjectPolicy(root, { trustCodex: false, codegraph: false }),
    ).toEqual({ trustCodex: false, codegraph: false });
  });
});

describe.skipIf(!hasCodex)("native Codex project initialization", () => {
  const options = { yes: true, codex: true, user: "fixture", codegraph: false };

  it("trusts first init and reentry through native APIs without executing project Hooks", async () => {
    await init({ ...options, trustCodex: true });
    const config = fs.readFileSync(path.join(home, "config.toml"), "utf8");
    expect(config).toContain('trust_level = "trusted"');
    expect(config.match(/trusted_hash/g)).toHaveLength(10);
    expect(fs.existsSync(path.join(root, ".trellis/.developer"))).toBe(true);
    const hooks = fs.readFileSync(path.join(root, ".codex/hooks.json"), "utf8");
    await init({ ...options, trustCodex: true });
    expect(fs.readFileSync(path.join(home, "config.toml"), "utf8")).toBe(
      config,
    );
    expect(fs.readFileSync(path.join(root, ".codex/hooks.json"), "utf8")).toBe(
      hooks,
    );
    expect(fs.existsSync(path.join(home, "sessions"))).toBe(false);
  }, 60_000);

  it("rejects modified managed scripts before force can rewrite them", async () => {
    await init({ ...options, trustCodex: false });
    const file = path.join(root, ".codex/hooks/inject-workflow-state.py");
    const edited = fs.readFileSync(file, "utf8") + "\n# local modification\n";
    fs.writeFileSync(file, edited);
    await expect(
      init({ ...options, trustCodex: true, force: true }),
    ).rejects.toThrow("Modified or redirected");
    expect(fs.readFileSync(file, "utf8")).toBe(edited);
    expect(
      fs.readFileSync(path.join(home, "config.toml"), "utf8"),
    ).not.toContain("trust_level");
  }, 60_000);

  it("retains explicit untrusted choice and disabled Hooks", async () => {
    const config = `[features]\nhooks = true\n[projects.${JSON.stringify(root)}]\ntrust_level = "untrusted"\n`;
    fs.writeFileSync(path.join(home, "config.toml"), config);
    await expect(init({ ...options, trustCodex: true })).rejects.toThrow(
      "explicit untrusted",
    );
    expect(fs.readFileSync(path.join(home, "config.toml"), "utf8")).toBe(
      config,
    );
    fs.writeFileSync(
      path.join(home, "config.toml"),
      "[features]\nhooks = false\n",
    );
    await expect(init({ ...options, trustCodex: true })).rejects.toThrow(
      "hooks are disabled",
    );
    expect(fs.existsSync(path.join(root, ".trellis"))).toBe(false);
  }, 60_000);

  it("preserves unknown project configuration instead of blessing or overwriting it", async () => {
    await init({ ...options, trustCodex: false });
    const file = path.join(root, ".codex/config.toml");
    const content =
      'model = "external-choice"\n' + fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, content);
    await expect(
      init({ ...options, trustCodex: true, force: true }),
    ).rejects.toThrow("Unknown project configuration");
    expect(fs.readFileSync(file, "utf8")).toBe(content);
    expect(
      fs.readFileSync(path.join(home, "config.toml"), "utf8"),
    ).not.toContain("trust_level");
  }, 60_000);
});
