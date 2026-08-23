import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PLATFORM_IDS } from "../../src/configurators/index.js";
import { resolveBundledSkills } from "../../src/configurators/shared.js";
import { AI_TOOLS } from "../../src/types/ai-tools.js";

const SOURCE_ROOT = path.join(
  process.cwd(),
  "src",
  "templates",
  "common",
  "bundled-skills",
  "trellis-channel",
);

function sourceFile(relativePath: string): string {
  return fs.readFileSync(path.join(SOURCE_ROOT, relativePath), "utf-8");
}

function renderedFile(platform: (typeof PLATFORM_IDS)[number], relativePath: string): string {
  const resolved = resolveBundledSkills(AI_TOOLS[platform].templateContext).find(
    (file) => file.relativePath === `trellis-channel/${relativePath}`,
  );
  if (!resolved) throw new Error(`missing rendered trellis-channel/${relativePath} for ${platform}`);
  return resolved.content;
}

describe("trellis-channel governed profile routing", () => {
  it("places the governed profile gate before ordinary workflow routing", () => {
    const skill = sourceFile("SKILL.md");
    const workflows = sourceFile("references/workflows.md");

    expect(skill).toContain("distribution.profile");
    expect(skill).toContain("codex-only-analysis-channel");
    expect(skill).toContain("dispatch.backend");
    expect(skill).toContain("codex-workflow-dispatch");
    expect(skill).toContain("main session retains implementation");
    expect(workflows).toContain("Routing precondition");
    expect(workflows).toContain("Pattern B: Implement / Check Agent (Non-Governed Projects Only)");
    expect(workflows).toContain("do not select Pattern B");
  });

  it("preserves the same routing guard in every platform's bundled output", () => {
    const source = {
      skill: sourceFile("SKILL.md"),
      workflows: sourceFile("references/workflows.md"),
      workers: sourceFile("references/workers.md"),
    };

    for (const platform of PLATFORM_IDS) {
      expect(renderedFile(platform, "SKILL.md"), platform).toBe(source.skill);
      expect(renderedFile(platform, "references/workflows.md"), platform).toBe(source.workflows);
      expect(renderedFile(platform, "references/workers.md"), platform).toBe(source.workers);
    }
  });

  it("keeps direct worker examples available for ordinary projects", () => {
    const workflows = sourceFile("references/workflows.md");
    const workers = sourceFile("references/workers.md");

    expect(workflows).toContain("--agent check");
    expect(workflows).toContain("--agent implement");
    expect(workers).toContain("--agent check");
  });
});
