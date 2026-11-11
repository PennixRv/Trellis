import { describe, expect, it } from "vitest";

import { getAllHooks, getConfigTemplate, getHooksConfig } from "../../src/templates/codex/index.js";
import { resolveAllAsSkills } from "../../src/configurators/shared.js";
import { AI_TOOLS } from "../../src/types/ai-tools.js";

// Shared skills are now sourced from common/ via resolveAllAsSkills
describe("codex shared skills (from common source)", () => {
  it("resolves all common templates for codex context", () => {
    const skills = resolveAllAsSkills(AI_TOOLS.codex.templateContext);
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.content).toContain("description:");
      expect(skill.content).toContain(`name: ${skill.name}`);
    }
  });

  it("does not include platform-specific syntax in resolved output", () => {
    const skills = resolveAllAsSkills(AI_TOOLS.codex.templateContext);
    for (const skill of skills) {
      // Codex uses $ prefix, not /trellis:
      expect(skill.content).not.toContain("/trellis:");
      expect(skill.content).not.toContain(".claude/");
      expect(skill.content).not.toContain(".cursor/");
    }
  });
});

describe("codex native sub-agent hooks", () => {
  it("registers dynamic spec injection and preserves existing context hooks", () => {
    const config = JSON.parse(getHooksConfig()) as {
      hooks: Record<
        string,
        {
          matcher?: string;
          hooks: {
            command: string;
            timeout?: number;
            additionalContextLimit?: number;
          }[];
        }[]
      >;
    };

    expect(config.hooks.UserPromptSubmit).toHaveLength(1);
    expect(config.hooks.UserPromptSubmit[0]?.hooks[0]?.command).toContain(
      ".codex/hooks/inject-workflow-state.py",
    );

    expect(config.hooks.SubagentStart).toBeUndefined();

    expect(config.hooks.SessionStart).toHaveLength(1);
    expect(config.hooks.SessionStart[0]?.matcher).toBe("^(?:clear|compact)$");
    expect(config.hooks.SessionStart[0]?.hooks[0]?.command).toContain(
      ".codex/hooks/inject-spec-context.py",
    );

    expect(config.hooks.PreToolUse).toHaveLength(2);
    expect(config.hooks.PreToolUse[0]?.hooks[0]?.command).toContain(
      "guard-teamwork-wait.py",
    );
    expect(config.hooks.PreToolUse[1]?.matcher).toBe("Edit|Write");
    expect(config.hooks.PreToolUse[1]?.hooks[0]).toMatchObject({
      timeout: 15,
      additionalContextLimit: 0,
    });
    expect(config.hooks.PreToolUse[1]?.hooks[0]?.command).toContain(
      ".codex/hooks/inject-spec-context.py",
    );
  });
});

describe("codex SessionStart phase guidance", () => {
  it("does not infer the business phase from lifecycle status or artifact presence", () => {
    const content =
      getAllHooks().find((hook) => hook.name === "session-start.py")?.content ??
      "";
    expect(content).toContain("current per-turn workflow-state");
    expect(content).toContain("do not identify the business phase");
    expect(content).toContain(
      "choose applicable ordered phases with evidence for omissions",
    );
    expect(content).not.toContain("trellis-brainstorm");
    expect(content).not.toContain("complex task must add");
  });
});

describe("codex getConfigTemplate", () => {
  it("returns project config.toml content", () => {
    const config = getConfigTemplate();
    expect(config.targetPath).toBe("config.toml");
    expect(config.content).toContain("project_doc_fallback_filenames");
    expect(config.content).toContain("AGENTS.md");
  });

  // The structured [features.multi_agent_v2] table form is only accepted by
  // Codex CLI 0.131+. On 0.130 and earlier — including the codex CLI bundled
  // in the Codex desktop app — it aborts the whole config load with
  // `data did not match any variant of untagged enum FeatureToml`. Trellis
  // no longer writes the block; this test guards against reintroducing it.
  it("does not write a [features.multi_agent_v2] block (Codex 0.130 compat)", () => {
    const config = getConfigTemplate();
    expect(config.content).not.toMatch(/^\[features\.multi_agent_v2\]/m);
  });

  it("disables native agents without a depth workaround", () => {
    const config = getConfigTemplate();
    expect(config.content).toMatch(/^enabled = false$/m);
    expect(config.content).not.toContain("max_depth");
  });
});
