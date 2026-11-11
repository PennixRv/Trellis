import { describe, expect, it } from "vitest";
import { collectReasonixTemplates } from "../../src/configurators/reasonix.js";

describe("Reasonix ordinary methods", () => {
  it("ships a single ordinary check Skill and no implementation role", () => {
    const files = collectReasonixTemplates();
    expect(files.has(".reasonix/skills/trellis-implement/SKILL.md")).toBe(false);
    expect(files.get(".reasonix/skills/trellis-check/SKILL.md")).toContain("name: trellis-check");
    for (const body of files.values()) expect(body).not.toMatch(/^runAs:\s*subagent/m);
  });
});
