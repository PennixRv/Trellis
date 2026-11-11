import { describe, expect, it } from "vitest";
import { getDshGuide } from "../../src/templates/dsh/index.js";

import { collectDshTemplates } from "../../src/configurators/dsh.js";
import { collectPiTemplates } from "../../src/configurators/pi.js";

describe("dsh template readers", () => {

  it("ships an operator guide with both plugin and no-plugin paths", () => {
    const guide = getDshGuide();
    expect(guide).toContain("trellis teamwork");
    expect(guide).toContain("paseo-based-parallelism");
    expect(guide).not.toContain("run_in_background");
    expect(guide).toContain("DSH_TRELLIS_CONTEXT_ID");
    expect(guide).toContain("`DSH_SHELL=1` together with `DSH_SESSION_ID`");
    expect(guide).not.toContain("unset `TRELLIS_CONTEXT_ID`");
    expect(guide).toContain("creates a fresh DSH session");
  });
});

describe("dsh collectDshTemplates", () => {
  it("writes entry skills and collision-free role skills under .dsh/skills/", () => {
    const files = collectDshTemplates();

    expect(files.has(".dsh/skills/trellis-start/SKILL.md")).toBe(true);
    expect(files.has(".dsh/skills/trellis-continue/SKILL.md")).toBe(true);
    expect(files.has(".dsh/skills/trellis-finish-work/SKILL.md")).toBe(true);

    expect(files.has(".dsh/skills/trellis-agent-implement/SKILL.md")).toBe(false);
    expect(files.has(".dsh/skills/trellis-agent-check/SKILL.md")).toBe(false);
    expect(files.has(".dsh/skills/trellis-agent-research/SKILL.md")).toBe(false);
    expect(files.has(".dsh/skills/trellis-check/SKILL.md")).toBe(false);

    expect(files.has(".dsh/skills/trellis-agent-implement/SKILL.md")).toBe(false);

  });

  it("collects the phase-aware entry skill for DSH", () => {
    const files = collectDshTemplates();
    const start = files.get(".dsh/skills/trellis-start/SKILL.md");
    const finish = files.get(".dsh/skills/trellis-finish-work/SKILL.md");

    expect(start).toContain("task.py phase init");
    expect(start).toContain("Goal Exploration and Requirements Confirmation Phase");
    expect(start).toContain("Delivery Review and On-Site Closeout Phase");
    expect(start).toContain("name: trellis-start");
    expect(finish).toContain("Task completion and cancellation are handled during Delivery Review and On-Site Closeout Phase");
    expect(finish).toContain("formal session handoff to its separate");
  });

  it("writes workflow + bundled skills byte-identically to Pi's shared writes", () => {
    const dshFiles = collectDshTemplates();
    const piFiles = collectPiTemplates();

    expect(dshFiles.has(".agents/skills/trellis-check/SKILL.md")).toBe(true);
    expect(dshFiles.has(".agents/skills/trellis-before-dev/SKILL.md")).toBe(
      true,
    );
    expect(dshFiles.has(".agents/skills/trellis-meta/SKILL.md")).toBe(true);
    expect(dshFiles.has(".agents/skills/trellis-start/SKILL.md")).toBe(false);

    for (const [key, value] of dshFiles) {
      if (!key.startsWith(".agents/skills/")) continue;
      expect(
        piFiles.get(key),
        `${key} must be byte-identical to Pi's shared-skill write`,
      ).toBe(value);
    }
  });

  it("keeps the bundled meta reference explicit about the DSH fallback", () => {
    const metaAgents = collectDshTemplates().get(
      ".agents/skills/trellis-meta/references/platform-files/agents.md",
    );

    expect(metaAgents).toContain(
      "paseo-based-parallelism",
    );
    expect(metaAgents).not.toContain("otherwise initial foreground dispatch");
  });

  it("ships the operator guide and no hooks/settings files", () => {
    const files = collectDshTemplates();
    expect(files.get(".dsh/DSH.md")).toContain(
      "main-session breadcrumbs",
    );
    for (const key of files.keys()) {
      expect(key.startsWith(".dsh/hooks")).toBe(false);
      expect(key).not.toBe(".dsh/settings.json");
      expect(key).not.toBe(".dsh/config.toml");
    }
  });
});
