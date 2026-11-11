import { describe, expect, it } from "vitest";
import { getHooksConfig } from "../../src/templates/zcode/index.js";

describe("zcode getHooksConfig", () => {
  it("targets .zcode/config.json (workspace config form)", () => {
    const cfg = getHooksConfig();
    expect(cfg.targetPath).toBe("config.json");
    expect(cfg.content.length).toBeGreaterThan(0);
  });

  it("enables hooks and registers SessionStart + UserPromptSubmit + PreToolUse under events", () => {
    // ZCode workspace config schema: { hooks: { enabled: true, events: {...} } }
    // (distinct from plugin hooks.json which omits the enabled/events wrapper).
    const cfg = getHooksConfig();
    expect(cfg.content).toContain('"enabled": true');
    expect(cfg.content).toContain('"events"');
    expect(cfg.content).toContain('"SessionStart"');
    expect(cfg.content).toContain('"UserPromptSubmit"');
    expect(cfg.content).toContain('"PreToolUse"');
    expect(cfg.content).not.toContain('"matcher": "Agent|Task"');
    expect(cfg.content).toContain("session-start.py");
    expect(cfg.content).toContain("inject-workflow-state.py");
    expect(cfg.content).not.toContain("inject-subagent-context.py");
    // Uses {{PYTHON_CMD}} placeholder so init resolves host python.
    expect(cfg.content).toContain("{{PYTHON_CMD}}");
  });

  it("anchors hook commands to the ZCode project root", () => {
    const cfg = JSON.parse(getHooksConfig().content) as {
      hooks: {
        events: Record<
          string,
          { hooks: { command: string }[] }[]
        >;
      };
    };

    const commands = Object.values(cfg.hooks.events).flatMap((entries) =>
      entries.flatMap((entry) => entry.hooks.map((hook) => hook.command)),
    );

    expect(commands).toEqual(
      expect.arrayContaining([
        '{{PYTHON_CMD}} "${ZCODE_PROJECT_DIR}/.zcode/hooks/session-start.py"',
        '{{PYTHON_CMD}} "${ZCODE_PROJECT_DIR}/.zcode/hooks/inject-workflow-state.py"',
      ]),
    );
    for (const command of commands) {
      expect(command).not.toMatch(/{{PYTHON_CMD}}\s+\.zcode\/hooks\//);
    }
  });
});
