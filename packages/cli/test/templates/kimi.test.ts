import { describe, expect, it } from "vitest";


import { collectKimiTemplates } from "../../src/configurators/kimi.js";
import { collectPiTemplates } from "../../src/configurators/pi.js";

describe("kimi collectKimiTemplates", () => {
  it("writes commands-as-skills and agent prompts under .kimi-code/skills/", () => {
    const files = collectKimiTemplates();

    // User-invocable entry points (/skill:trellis-<name>)
    expect(files.has(".kimi-code/skills/trellis-start/SKILL.md")).toBe(true);
    expect(files.has(".kimi-code/skills/trellis-continue/SKILL.md")).toBe(true);
    expect(files.has(".kimi-code/skills/trellis-finish-work/SKILL.md")).toBe(
      true,
    );

    // Trellis agent prompts (also installed as `.kimi-code/agents/*.md`)
    expect(files.has(".kimi-code/skills/trellis-implement/SKILL.md")).toBe(false);
    expect(files.has(".kimi-code/skills/trellis-check/SKILL.md")).toBe(false);
    expect(files.has(".kimi-code/skills/trellis-research/SKILL.md")).toBe(false);


  });

  it("writes workflow + bundled skills to the shared .agents/skills/ root", () => {
    const files = collectKimiTemplates();
    expect(files.has(".agents/skills/trellis-check/SKILL.md")).toBe(true);
    expect(files.has(".agents/skills/trellis-before-dev/SKILL.md")).toBe(true);
    expect(files.has(".agents/skills/trellis-meta/SKILL.md")).toBe(true);
    // Command-as-skill files stay Kimi-private (Codex owns the shared
    // trellis-start/continue/finish-work fallback copies).
    expect(files.has(".agents/skills/trellis-start/SKILL.md")).toBe(false);
    expect(files.has(".agents/skills/trellis-finish-work/SKILL.md")).toBe(
      false,
    );
  });

  it("renders .agents/skills/ files byte-identically to Pi's shared writes", () => {
    const kimiFiles = collectKimiTemplates();
    const piFiles = collectPiTemplates();
    for (const [key, content] of kimiFiles) {
      if (!key.startsWith(".agents/skills/")) continue;
      expect(
        piFiles.get(key),
        `${key} must be byte-identical to Pi's shared-skill write`,
      ).toBe(content);
    }
  });
});
