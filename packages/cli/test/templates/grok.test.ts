import { describe, expect, it } from "vitest";


import { collectGrokTemplates } from "../../src/configurators/grok.js";

describe("grok collectGrokTemplates", () => {
  it("writes flat trellis-*.md commands and agents under .grok/", () => {
    const files = collectGrokTemplates();
    expect(files.has(".grok/commands/trellis-start.md")).toBe(true);
    expect(files.has(".grok/commands/trellis-continue.md")).toBe(true);
    expect(files.has(".grok/commands/trellis-finish-work.md")).toBe(true);
    // Nested ZCode-style layout must not be used
    expect(files.has(".grok/commands/trellis/start.md")).toBe(false);

    expect(files.has(".grok/agents/trellis-implement.md")).toBe(false);
    expect(files.has(".grok/agents/trellis-check.md")).toBe(false);
    expect(files.has(".grok/agents/trellis-research.md")).toBe(false);


  });

  it("includes private skills under .grok/skills/", () => {
    const files = collectGrokTemplates();
    expect(files.has(".grok/skills/trellis-check/SKILL.md")).toBe(true);
    expect(files.has(".grok/skills/trellis-before-dev/SKILL.md")).toBe(true);
  });
});
