import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSettingsTemplate } from "../../src/templates/trae/index.js";
import { resolveAllAsSkills, resolveSkills, resolveBundledSkills } from "../../src/configurators/shared.js";
import { AI_TOOLS } from "../../src/types/ai-tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

// Shared skills are sourced from common/ via resolveAllAsSkills (written to
// .trae/skills/ — Trae has its own private config dir, no .agents/skills alias).
describe("trae shared skills (from common source)", () => {
  it("resolves all common templates for trae context", () => {
    const skills = resolveAllAsSkills(AI_TOOLS.trae.templateContext);
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.content).toContain("description:");
      expect(skill.content).toContain(`name: ${skill.name}`);
    }
  });

  it("does not include platform-specific syntax in resolved output", () => {
    const skills = resolveAllAsSkills(AI_TOOLS.trae.templateContext);
    for (const skill of skills) {
      // Trae uses /trellis- prefix, not /trellis:
      expect(skill.content).not.toContain("/trellis:");
      expect(skill.content).not.toContain(".claude/");
      expect(skill.content).not.toContain(".cursor/");
    }
  });

  it("resolves bundled skills for trae context", () => {
    const bundled = resolveBundledSkills(AI_TOOLS.trae.templateContext);
    expect(bundled.length).toBeGreaterThan(0);
  });

  it("resolves auto-triggered skills (resolveSkills) for trae context", () => {
    const skills = resolveSkills(AI_TOOLS.trae.templateContext);
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.content).toContain("description:");
      expect(skill.content).toContain(`name: ${skill.name}`);
    }
  });
});

describe("trae has no config.toml (no Codex CLI trust mechanism)", () => {
  it("does not ship a config.toml template", () => {
    const configPath = path.join(
      repoRoot,
      "packages/cli/src/templates/trae/config.toml",
    );
    expect(fs.existsSync(configPath)).toBe(false);
  });
});

describe("trae hooks.json registers SessionStart + UserPromptSubmit", () => {
  const hooksPath = path.join(
    repoRoot,
    "packages/cli/src/templates/trae/hooks.json",
  );

  it("includes version field and wires session-start.py under SessionStart", () => {
    const raw = fs.readFileSync(hooksPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: number; hooks?: Record<string, unknown> };
    expect(parsed.version).toBe(1);
    expect(parsed.hooks).toBeDefined();
    expect(Object.keys(parsed.hooks ?? {})).toContain("SessionStart");
    expect(raw).toContain(".trae/hooks/session-start.py");
    // Trae docs: matcher is only for PreToolUse/PostToolUse/Notification.
    // SessionStart fires once per new session (source: "startup" only).
    // Having matchers on SessionStart would cause 3x execution or be ignored.
    const sessionStartGroups = (parsed.hooks as Record<string, Record<string, unknown>[]>)["SessionStart"];
    expect(sessionStartGroups).toHaveLength(1);
    expect(sessionStartGroups[0]).not.toHaveProperty("matcher");
  });

  it("wires inject-workflow-state.py under UserPromptSubmit", () => {
    const raw = fs.readFileSync(hooksPath, "utf-8");
    const parsed = JSON.parse(raw) as { hooks?: Record<string, unknown> };
    expect(parsed.hooks).toBeDefined();
    expect(Object.keys(parsed.hooks ?? {})).toContain("UserPromptSubmit");
    expect(raw).toContain(".trae/hooks/inject-workflow-state.py");
  });

  it("wires inject-shell-session-context.py under PreToolUse with a Bash matcher", () => {
    // Trae gives a shell command's session id to hooks only, never to the
    // command's own environment, so the pre-shell ticket is how `task.py`
    // learns which session it belongs to. PreToolUse is one of the events
    // whose matcher Trae honors (see the SessionStart test above).
    const raw = fs.readFileSync(hooksPath, "utf-8");
    const parsed = JSON.parse(raw) as { hooks?: Record<string, unknown> };
    const preToolUseGroups = (
      parsed.hooks as Record<string, Record<string, unknown>[]>
    )["PreToolUse"];
    expect(preToolUseGroups).toHaveLength(1);
    // Trae's IDE names its shell tool `RunCommand`, not `Bash` — a `Bash`-only
    // matcher never fired. `Bash` is kept in the alternation because matcher is
    // a regex on every surface and dropping it would be an untested narrowing.
    expect(preToolUseGroups[0].matcher).toBe("RunCommand|Bash");
    expect(raw).toContain(".trae/hooks/inject-shell-session-context.py");
  });

  it("does not register any other hook events", () => {
    const raw = fs.readFileSync(hooksPath, "utf-8");
    const parsed = JSON.parse(raw) as { hooks?: Record<string, unknown> };
    expect(Object.keys(parsed.hooks ?? {}).sort()).toEqual(
      ["PreToolUse", "SessionStart", "UserPromptSubmit"].sort(),
    );
  });

  it("UserPromptSubmit hook group has no matcher", () => {
    const raw = fs.readFileSync(hooksPath, "utf-8");
    const parsed = JSON.parse(raw) as { hooks?: Record<string, unknown> };
    const userPromptGroups = (parsed.hooks as Record<string, Record<string, unknown>[]>)["UserPromptSubmit"];
    expect(userPromptGroups).toHaveLength(1);
    expect(userPromptGroups[0]).not.toHaveProperty("matcher");
  });
});

describe("trae getSettingsTemplate", () => {
  it("returns hooks.json as the target path with version field", () => {
    const settings = getSettingsTemplate();
    expect(settings.targetPath).toBe("hooks.json");
    expect(settings.content).toContain("\"version\": 1");
    expect(settings.content).toContain("SessionStart");
    expect(settings.content).toContain("UserPromptSubmit");
  });
});

// inject-workflow-state.py is shared across platforms; its _detect_platform()
// must map a hook installed under .trae/ to the "trae" platform so the
// breadcrumb is emitted with the right context (mirrors the .codex branch).
describe("trae platform detection in shared inject-workflow-state.py", () => {
  it("_detect_platform returns 'trae' for a .trae script path", () => {
    const hookPath = path.join(
      repoRoot,
      "packages/cli/src/templates/shared-hooks/inject-workflow-state.py",
    );
    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toMatch(/if "\.trae" in script_parts:\s*\n\s*return "trae"/);
  });
});

// session-start.py is also a shared hook for Trae; it must detect .trae paths
// and TRAE_PROJECT_DIR env so the SessionStart context is emitted correctly.
describe("trae platform detection in shared session-start.py", () => {
  it("detects .trae directory and TRAE_PROJECT_DIR env", () => {
    const hookPath = path.join(
      repoRoot,
      "packages/cli/src/templates/shared-hooks/session-start.py",
    );
    const content = fs.readFileSync(hookPath, "utf-8");
    expect(content).toMatch(/if "\.trae" in script_parts:\s*\n\s*return "trae"/);
    expect(content).toContain("TRAE_PROJECT_DIR");
  });
});
