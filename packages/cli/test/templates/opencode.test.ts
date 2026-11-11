import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TrellisContext } from "../../src/templates/opencode/lib/trellis-context.js";
import { findUserTextPart, insertSyntheticTextPart, MESSAGES_TRANSFORM_HOOK, prependEphemeralText } from "../../src/templates/opencode/lib/context-visibility.js";
import { buildSessionContext, hasInjectedTrellisContext } from "../../src/templates/opencode/lib/session-utils.js";

import injectSpecContextPlugin from "../../src/templates/opencode/plugins/inject-spec-context.js";
import injectShellSessionContextPlugin from "../../src/templates/opencode/plugins/inject-shell-session-context.js";
import sessionStartPlugin from "../../src/templates/opencode/plugins/session-start.js";
import injectWorkflowStatePlugin from "../../src/templates/opencode/plugins/inject-workflow-state.js";

interface OpenCodeInjectHooks {
  "tool.execute.before": (
    input: unknown,
    output: { args: { command: string } },
  ) => Promise<void>;
}

async function createOpenCodeInjectHooks(
  platform: NodeJS.Platform = "linux",
  env: NodeJS.ProcessEnv = {},
): Promise<OpenCodeInjectHooks> {
  return (await injectShellSessionContextPlugin({
    directory: "/tmp/trellis-opencode-test",
    platform,
    env,
  })) as OpenCodeInjectHooks;
}

interface OpenCodeSpecHooks {
  event: (input: { event: unknown }) => Promise<void>;
  "tool.execute.before": (
    input: { tool: string; sessionID: string },
    output: { args: Record<string, unknown> },
  ) => Promise<void>;
}

function setupSpecHookFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "trellis-opencode-spec-"));
  const hooksDir = join(dir, ".opencode", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(
    join(hooksDir, "inject-spec-context.py"),
    [
      "import json",
      "import sys",
      "from pathlib import Path",
      "",
      "payload = json.load(sys.stdin)",
      'root = Path(payload["cwd"])',
      'log = root / "hook-events.jsonl"',
      'with log.open("a", encoding="utf-8") as handle:',
      '    handle.write(json.dumps(payload) + "\\n")',
      'state = root / "hook-state"',
      'if payload.get("hook_event_name") == "SessionStart":',
      "    state.unlink(missing_ok=True)",
      "elif not state.exists():",
      '    state.write_text("seen", encoding="utf-8")',
      '    print(json.dumps({"hookSpecificOutput": {"additionalContext": "<spec-context>OPEN_CODE_SPEC_RULE</spec-context>", "permissionDecision": "deny"}}))',
      "",
    ].join("\n"),
    "utf-8",
  );
  return dir;
}

describe("opencode dynamic spec injection", () => {
  it("shows governing specs before a write, allows retry, and resets after compaction", async () => {
    const dir = setupSpecHookFixture();
    try {
      const hooks = (await injectSpecContextPlugin({
        directory: dir,
      })) as OpenCodeSpecHooks;
      const output = {
        args: { filePath: "src/demo.ts", content: "wrong" },
      };

      await expect(
        hooks["tool.execute.before"](
          { tool: "write", sessionID: "session-a" },
          output,
        ),
      ).rejects.toThrow("OPEN_CODE_SPEC_RULE");
      await expect(
        hooks["tool.execute.before"](
          { tool: "write", sessionID: "session-a" },
          output,
        ),
      ).resolves.toBeUndefined();

      await hooks.event({
        event: {
          type: "session.compacted",
          properties: { sessionID: "session-a" },
        },
      });

      await expect(
        hooks["tool.execute.before"](
          { tool: "write", sessionID: "session-a" },
          output,
        ),
      ).rejects.toThrow("OPEN_CODE_SPEC_RULE");

      const events = readFileSync(join(dir, "hook-events.jsonl"), "utf-8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(events[0]).toMatchObject({
        hook_event_name: "PreToolUse",
        session_id: "session-a",
        tool_name: "Write",
        tool_input: { file_path: "src/demo.ts" },
      });
      expect(events[2]).toMatchObject({
        hook_event_name: "SessionStart",
        session_id: "session-a",
        source: "compact",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("forwards the native apply_patch grammar to the shared spec engine", async () => {
    const dir = setupSpecHookFixture();
    try {
      const hooks = (await injectSpecContextPlugin({
        directory: dir,
      })) as OpenCodeSpecHooks;
      const patchText = [
        "*** Begin Patch",
        "*** Update File: src/one.ts",
        "*** Move to: src/two.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n");

      await expect(
        hooks["tool.execute.before"](
          { tool: "apply_patch", sessionID: "session-b" },
          { args: { patchText } },
        ),
      ).rejects.toThrow("OPEN_CODE_SPEC_RULE");

      const [event] = readFileSync(join(dir, "hook-events.jsonl"), "utf-8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(event).toMatchObject({
        hook_event_name: "PreToolUse",
        session_id: "session-b",
        tool_name: "apply_patch",
        tool_input: { command: patchText },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("maps edit filePath to the shared Edit trigger", async () => {
    const dir = setupSpecHookFixture();
    try {
      const hooks = (await injectSpecContextPlugin({
        directory: dir,
      })) as OpenCodeSpecHooks;

      await expect(
        hooks["tool.execute.before"](
          { tool: "edit", sessionID: "session-c" },
          {
            args: {
              filePath: "src/demo.ts",
              oldString: "wrong",
              newString: "right",
            },
          },
        ),
      ).rejects.toThrow("OPEN_CODE_SPEC_RULE");

      const [event] = readFileSync(join(dir, "hook-events.jsonl"), "utf-8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(event).toMatchObject({
        hook_event_name: "PreToolUse",
        session_id: "session-c",
        tool_name: "Edit",
        tool_input: { file_path: "src/demo.ts" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
interface ChatMessagePart {
  id?: string;
  sessionID?: string;
  messageID?: string;
  type: string;
  text?: string;
  synthetic?: boolean;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface TransformMessage {
  info: { role: string; sessionID?: string; agent?: string };
  parts: ChatMessagePart[];
}

interface TransformHooks {
  "experimental.chat.messages.transform": (
    input: object,
    output: { messages: TransformMessage[] },
  ) => Promise<void>;
}

function createUserTextPart(
  text: string,
  sessionID = "main-session",
  messageID = "message-a",
  ordinal = "000000000010",
): ChatMessagePart {
  return {
    id: `prt_${ordinal}abcdefghijklmn`,
    sessionID,
    messageID,
    type: "text",
    text,
  };
}

function userTurn(
  text: string,
  opts: { sessionID?: string; agent?: string; messageID?: string } = {},
): TransformMessage {
  const sessionID = opts.sessionID ?? "main-session";
  return {
    info: {
      role: "user",
      sessionID,
      agent: opts.agent ?? "build",
    },
    parts: [createUserTextPart(text, sessionID, opts.messageID)],
  };
}

describe("opencode session-start history detection", () => {

  it("discovers neutral indexes without leaking excluded package indexes", () => {
    const dir = mkdtempSync(join(tmpdir(), "trellis-opencode-indexes-"));
    try {
      cpSync(
        join(__dirname, "../../src/templates/trellis/scripts"),
        join(dir, ".trellis/scripts"),
        { recursive: true },
      );
      writeFileSync(
        join(dir, ".trellis/config.yaml"),
        "packages:\n  cli:\n    path: packages/cli\n  other:\n    path: packages/other\ndefault_package: cli\nsession:\n  spec_scope: active_task\n",
      );
      for (const index of [
        "index.md",
        "guides/index.md",
        "cli/index.md",
        "cli/custom/index.md",
        "other/index.md",
        "other/custom/index.md",
        "legacy/index.md",
      ]) {
        const file = join(dir, ".trellis/spec", index);
        mkdirSync(join(file, ".."), { recursive: true });
        writeFileSync(file, "# Confirmed conventions\n");
      }
      const context = buildSessionContext({
        directory: dir,
        getActiveTask: () => ({ taskPath: null, source: "none", stale: false }),
        getContextKey: () => null,
        getCurrentTask: () => null,
        readFile: () => "",
        readProjectFile: () => "",
        resolveTaskDir: () => null,
        runScript: () => "",
      });
      for (const index of [
        "index.md",
        "guides/index.md",
        "cli/index.md",
        "cli/custom/index.md",
        "legacy/index.md",
      ])
        expect(context).toContain(`.trellis/spec/${index}`);
      expect(context).not.toContain(".trellis/spec/other/index.md");
      expect(context).not.toContain(".trellis/spec/other/custom/index.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds compact startup context with an adaptive one-shot acknowledgment", () => {
    const context = buildSessionContext({
      directory: "/tmp/trellis-opencode-test",
      getActiveTask: () => ({ taskPath: null, source: "none", stale: false }),
      getContextKey: () => null,
      getCurrentTask: () => null,
      readFile: () => "",
      readProjectFile: () => "",
      resolveTaskDir: () => null,
      runScript: () => "",
    });

    expect(context.startsWith("<session-context>")).toBe(true);
    expect(context).toContain("Trellis compact SessionStart context");
    expect(context).toContain("<first-reply-notice>");
    expect(context).toContain("the user's current request");
    expect(context).toContain("the user message that triggered this reply");
    expect(context).toContain("has no clear natural language");
    expect(context).toContain(
      "explicitly established project communication language",
    );
    expect(context).toContain("Trellis SessionStart ✓");
    expect(context).toContain("Continue directly with the user's request");
    expect(context).toContain(
      "must not alter the language used for the remainder of the response",
    );
    expect(context).toContain("This notice is one-shot");
    expect(context.indexOf("the user's current request")).toBeLessThan(
      context.indexOf("explicitly established project communication language"),
    );
    expect(
      context.indexOf("explicitly established project communication language"),
    ).toBeLessThan(context.indexOf("Trellis SessionStart ✓"));
    expect(context.indexOf("<first-reply-notice>")).toBeLessThan(
      context.indexOf("<current-state>"),
    );
    expect(context).toContain("<guidelines>");
    expect(context).toContain("<ready>");
    expect(context).not.toContain("say once in Chinese");
    expect(context).not.toContain("exactly one short Chinese sentence");
    expect(context).not.toContain(
      "Trellis SessionStart 已注入：workflow、当前任务状态、开发者身份、git 状态、active tasks、spec 索引已加载。",
    );
  });

  it("does not infer the business phase from planning status or missing artifacts", () => {
    const dir = mkdtempSync(join(tmpdir(), "trellis-opencode-phase-"));
    const taskDir = join(dir, ".trellis", "tasks", "demo-task");
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(
      join(taskDir, "task.json"),
      JSON.stringify({
        id: "demo-task",
        status: "planning",
        meta: {
          task_workflow: {
            current_phase_id: "solution_design_and_convergence",
            phase_ids: [
              "goal_exploration_and_requirements",
              "solution_design_and_convergence",
              "delivery_review_and_closeout",
            ],
          },
        },
      }),
    );
    const context = buildSessionContext({
      directory: dir,
      getActiveTask: () => ({
        taskPath: ".trellis/tasks/demo-task",
        source: "test",
        stale: false,
      }),
      getContextKey: () => null,
      getCurrentTask: () => null,
      readFile: () => "",
      readProjectFile: () => "",
      resolveTaskDir: () => taskDir,
      runScript: () => "",
    });

    try {
      expect(context).toContain(
        "task lifecycle status and artifact presence do not identify the business phase",
      );
      expect(context).not.toContain("trellis-brainstorm");
      expect(context).not.toContain("PRD-only");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("injects startup context onto the latest user message without mutating stored parts", async () => {
    const hooks = (await sessionStartPlugin({
      directory: "/tmp/trellis-opencode-test",
    })) as TransformHooks;

    const firstUser = userTurn("First request", { sessionID: "session-a" });
    const originalFirstParts = firstUser.parts;
    const firstMessages = [firstUser];
    await hooks[MESSAGES_TRANSFORM_HOOK]({}, { messages: firstMessages });

    expect(originalFirstParts).toHaveLength(1);
    expect(originalFirstParts[0].text).toBe("First request");
    expect(firstMessages[0]).not.toBe(firstUser);
    expect(firstMessages[0].parts[0]).toMatchObject({
      type: "text",
      synthetic: true,
    });
    expect(firstMessages[0].parts[0].text).toMatch(/^<session-context>/);
    expect(firstMessages[0].parts[0].text).toContain("<first-reply-notice>");
    expect(firstMessages[0].parts[0].text).toContain("Trellis SessionStart ✓");
    expect(firstMessages[0].parts[1]).toEqual(originalFirstParts[0]);

    const laterUser = userTurn("Second request", {
      sessionID: "session-a",
      messageID: "message-b",
    });
    const originalLaterParts = laterUser.parts;
    const laterMessages = [
      firstUser,
      { info: { role: "assistant", sessionID: "session-a" }, parts: [] },
      laterUser,
    ];
    await hooks[MESSAGES_TRANSFORM_HOOK]({}, { messages: laterMessages });

    expect(laterMessages[0]).toBe(firstUser);
    expect(laterMessages[0].parts).toBe(originalFirstParts);
    expect(originalLaterParts).toHaveLength(1);
    expect(laterMessages[2].parts[0].text).toMatch(/^<session-context>/);
    expect(laterMessages[2].parts[0].text).not.toContain(
      "<first-reply-notice>",
    );
    expect(laterMessages[2].parts[1]).toEqual(originalLaterParts[0]);
  });

  it("detects persisted Trellis context from metadata", () => {
    const messages = [
      {
        info: { role: "user" },
        parts: [
          {
            type: "text",
            text: "hello",
            metadata: {
              trellis: {
                sessionStart: true,
              },
            },
          },
        ],
      },
    ];

    expect(hasInjectedTrellisContext(messages)).toBe(true);
  });

  it("ignores unrelated user messages", () => {
    const messages = [
      {
        info: { role: "user" },
        parts: [
          {
            type: "text",
            text: "normal prompt",
          },
        ],
      },
    ];

    expect(hasInjectedTrellisContext(messages)).toBe(false);
  });
});

describe("opencode bash session context", () => {
  it("injects TRELLIS_CONTEXT_ID into Bash commands from plugin sessionID", async () => {
    const hooks = await createOpenCodeInjectHooks();
    const output = {
      args: {
        command: "python3 ./.trellis/scripts/task.py start .trellis/tasks/demo",
      },
    };

    await hooks["tool.execute.before"](
      { tool: "bash", sessionID: "oc-a" },
      output,
    );

    expect(output.args.command).toBe(
      "export TRELLIS_CONTEXT_ID='opencode_oc-a'; python3 ./.trellis/scripts/task.py start .trellis/tasks/demo",
    );
  });

  it("uses PowerShell environment syntax on Windows", async () => {
    const hooks = await createOpenCodeInjectHooks("win32");
    const output = {
      args: {
        command: "python ./.trellis/scripts/task.py start .trellis/tasks/demo",
      },
    };

    await hooks["tool.execute.before"](
      { tool: "bash", sessionID: "oc-a" },
      output,
    );

    expect(output.args.command).toBe(
      "$env:TRELLIS_CONTEXT_ID = 'opencode_oc-a'; python ./.trellis/scripts/task.py start .trellis/tasks/demo",
    );
  });

  it("uses POSIX environment syntax on Windows Git Bash", async () => {
    const hooks = await createOpenCodeInjectHooks("win32", {
      MSYSTEM: "MINGW64",
    });
    const output = {
      args: {
        command: "git diff --name-only",
      },
    };

    await hooks["tool.execute.before"](
      { tool: "bash", sessionID: "oc-a" },
      output,
    );

    expect(output.args.command).toBe(
      "export TRELLIS_CONTEXT_ID='opencode_oc-a'; git diff --name-only",
    );
  });

  it("uses POSIX environment syntax when Windows OSTYPE indicates MSYS", async () => {
    const hooks = await createOpenCodeInjectHooks("win32", {
      OSTYPE: "msys",
    });
    const output = {
      args: {
        command: "git status --short",
      },
    };

    await hooks["tool.execute.before"](
      { tool: "bash", sessionID: "oc-a" },
      output,
    );

    expect(output.args.command).toBe(
      "export TRELLIS_CONTEXT_ID='opencode_oc-a'; git status --short",
    );
  });

  it("uses POSIX environment syntax when Windows MINGW_PREFIX is set", async () => {
    const hooks = await createOpenCodeInjectHooks("win32", {
      MINGW_PREFIX: "/mingw64",
    });
    const output = {
      args: {
        command: "git log --oneline -1",
      },
    };

    await hooks["tool.execute.before"](
      { tool: "bash", sessionID: "oc-a" },
      output,
    );

    expect(output.args.command).toBe(
      "export TRELLIS_CONTEXT_ID='opencode_oc-a'; git log --oneline -1",
    );
  });

  it("uses POSIX environment syntax when Windows SHELL is bash", async () => {
    const hooks = await createOpenCodeInjectHooks("win32", {
      SHELL: "/usr/bin/bash",
    });
    const output = {
      args: {
        command: "git branch --show-current",
      },
    };

    await hooks["tool.execute.before"](
      { tool: "bash", sessionID: "oc-a" },
      output,
    );

    expect(output.args.command).toBe(
      "export TRELLIS_CONTEXT_ID='opencode_oc-a'; git branch --show-current",
    );
  });

  it("uses POSIX environment syntax when OpenCode Git Bash path is configured", async () => {
    const hooks = await createOpenCodeInjectHooks("win32", {
      OPENCODE_GIT_BASH_PATH: "C:\\Program Files\\Git\\bin\\bash.exe",
    });
    const output = {
      args: {
        command: "git rev-parse --show-toplevel",
      },
    };

    await hooks["tool.execute.before"](
      { tool: "bash", sessionID: "oc-a" },
      output,
    );

    expect(output.args.command).toBe(
      "export TRELLIS_CONTEXT_ID='opencode_oc-a'; git rev-parse --show-toplevel",
    );
  });

  it("does not duplicate an explicit TRELLIS_CONTEXT_ID assignment", async () => {
    const hooks = await createOpenCodeInjectHooks();
    const output = {
      args: {
        command:
          "TRELLIS_CONTEXT_ID=manual python3 ./.trellis/scripts/task.py current",
      },
    };

    await hooks["tool.execute.before"](
      { tool: "bash", sessionID: "oc-a" },
      output,
    );

    expect(output.args.command).toBe(
      "TRELLIS_CONTEXT_ID=manual python3 ./.trellis/scripts/task.py current",
    );
  });

  it("does not duplicate an explicit exported TRELLIS_CONTEXT_ID", async () => {
    const hooks = await createOpenCodeInjectHooks();
    const output = {
      args: {
        command:
          "export TRELLIS_CONTEXT_ID=manual; python3 ./.trellis/scripts/task.py current",
      },
    };

    await hooks["tool.execute.before"](
      { tool: "bash", sessionID: "oc-a" },
      output,
    );

    expect(output.args.command).toBe(
      "export TRELLIS_CONTEXT_ID=manual; python3 ./.trellis/scripts/task.py current",
    );
  });

  it("does not duplicate an explicit env TRELLIS_CONTEXT_ID assignment", async () => {
    const hooks = await createOpenCodeInjectHooks();
    const output = {
      args: {
        command:
          "env FOO=bar TRELLIS_CONTEXT_ID=manual python3 ./.trellis/scripts/task.py current",
      },
    };

    await hooks["tool.execute.before"](
      { tool: "bash", sessionID: "oc-a" },
      output,
    );

    expect(output.args.command).toBe(
      "env FOO=bar TRELLIS_CONTEXT_ID=manual python3 ./.trellis/scripts/task.py current",
    );
  });

  it("does not duplicate an explicit PowerShell TRELLIS_CONTEXT_ID assignment", async () => {
    const hooks = await createOpenCodeInjectHooks("win32");
    const output = {
      args: {
        command:
          "$env:TRELLIS_CONTEXT_ID = 'manual'; python ./.trellis/scripts/task.py current",
      },
    };

    await hooks["tool.execute.before"](
      { tool: "bash", sessionID: "oc-a" },
      output,
    );

    expect(output.args.command).toBe(
      "$env:TRELLIS_CONTEXT_ID = 'manual'; python ./.trellis/scripts/task.py current",
    );
  });

  it("does not treat a grep pattern as an explicit TRELLIS_CONTEXT_ID assignment", async () => {
    const hooks = await createOpenCodeInjectHooks();
    const output = {
      args: {
        command: "env | sort | grep '^TRELLIS_CONTEXT_ID='",
      },
    };

    await hooks["tool.execute.before"](
      { tool: "bash", sessionID: "oc-a" },
      output,
    );

    expect(output.args.command).toBe(
      "export TRELLIS_CONTEXT_ID='opencode_oc-a'; env | sort | grep '^TRELLIS_CONTEXT_ID='",
    );
  });
});

describe("opencode persisted synthetic context parts", () => {
  it("creates deterministic complete identities without changing ordinary parts", () => {
    const ordinary = createUserTextPart("original prompt");
    ordinary.metadata = { user: { preserved: true } };
    const firstParts = [structuredClone(ordinary)];
    const secondParts = [structuredClone(ordinary)];

    const first = insertSyntheticTextPart(
      firstParts,
      "session context",
      "sessionStart",
    );
    const second = insertSyntheticTextPart(
      secondParts,
      "session context",
      "sessionStart",
    );

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      sessionID: "main-session",
      messageID: "message-a",
      type: "text",
      text: "session context",
      synthetic: true,
    });
    expect(first.id).toMatch(/^prt_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect(firstParts[1]).toEqual(ordinary);
    expect(secondParts[1]).toEqual(ordinary);
  });

  it("keeps both insertion orders equal to ID-sorted replay order", () => {
    for (const order of [
      ["sessionStart", "workflowState"],
      ["workflowState", "sessionStart"],
    ]) {
      const ordinary = createUserTextPart("ordinary user prompt");
      const parts = [structuredClone(ordinary)];

      for (const kind of order) {
        insertSyntheticTextPart(
          parts,
          kind === "sessionStart" ? "session context" : "workflow context",
          kind,
        );
      }

      expect(parts.map((part) => part.text)).toEqual([
        "session context",
        "workflow context",
        "ordinary user prompt",
      ]);
      expect(parts.map((part) => part.id)).toEqual(
        [...parts]
          .sort((left, right) =>
            left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
          )
          .map((part) => part.id),
      );
      expect(parts[0].id).not.toBe(parts[1].id);
      expect(parts[2]).toEqual(ordinary);
      expect(findUserTextPart(parts)).toBe(parts[2]);
    }
  });

  it("rejects unsupported kinds, missing identities, and duplicate IDs before mutation", () => {
    const unsupportedParts = [createUserTextPart("prompt")];
    const unsupportedBefore = structuredClone(unsupportedParts);
    expect(() =>
      insertSyntheticTextPart(unsupportedParts, "context", "unknown"),
    ).toThrow("unknown context part kind");
    expect(unsupportedParts).toEqual(unsupportedBefore);

    const unsupportedIdentityParts = [
      createUserTextPart(
        "prompt",
        "main-session",
        "message-low-ordinal",
        "000000000001",
      ),
    ];
    const unsupportedIdentityBefore = structuredClone(unsupportedIdentityParts);
    expect(() =>
      insertSyntheticTextPart(
        unsupportedIdentityParts,
        "context",
        "sessionStart",
      ),
    ).toThrow("unsupported OpenCode part ID ordinal");
    expect(unsupportedIdentityParts).toEqual(unsupportedIdentityBefore);

    const missingIdentityParts: ChatMessagePart[] = [
      { type: "text", text: "prompt" },
    ];
    const missingIdentityBefore = structuredClone(missingIdentityParts);
    expect(() =>
      insertSyntheticTextPart(missingIdentityParts, "context", "sessionStart"),
    ).toThrow("no ordinary OpenCode part with a persisted identity");
    expect(missingIdentityParts).toEqual(missingIdentityBefore);

    const duplicateParts = [createUserTextPart("prompt")];
    insertSyntheticTextPart(duplicateParts, "context", "workflowState");
    const duplicateBefore = structuredClone(duplicateParts);
    expect(() =>
      insertSyntheticTextPart(duplicateParts, "context", "workflowState"),
    ).toThrow("duplicate synthetic context part");
    expect(duplicateParts).toEqual(duplicateBefore);
  });

  it("fails closed on a legacy 19-character OpenCode part ID format without mutating parts", () => {
    // OpenCode has changed its part ID format before: a live DB observed 5 of
    // 2440 IDs still using this older, shorter shape. PART_ID_PATTERN must
    // reject it rather than silently treat it as a valid identity source.
    const legacyParts: ChatMessagePart[] = [
      {
        id: "prt_19b9634d8e5924s6zx6",
        sessionID: "main-session",
        messageID: "message-legacy",
        type: "text",
        text: "prompt",
      },
    ];
    const legacyBefore = structuredClone(legacyParts);
    expect(() =>
      insertSyntheticTextPart(legacyParts, "context", "sessionStart"),
    ).toThrow("no ordinary OpenCode part with a persisted identity");
    expect(legacyParts).toEqual(legacyBefore);
  });

  it("uses an ordinary attachment as the identity source", () => {
    const attachment: ChatMessagePart = {
      id: "prt_000000000010abcdefghijklmn",
      sessionID: "attachment-session",
      messageID: "attachment-message",
      type: "file",
      mime: "application/pdf",
      filename: "report.pdf",
    };
    const parts = [structuredClone(attachment)];

    const inserted = insertSyntheticTextPart(
      parts,
      "workflow context",
      "workflowState",
    );

    expect(inserted).toMatchObject({
      sessionID: "attachment-session",
      messageID: "attachment-message",
      synthetic: true,
    });
    expect(parts[1]).toEqual(attachment);
    expect(findUserTextPart(parts)).toBeUndefined();
  });

  it("uses the minimum-ordinal ordinary part as the identity source when a message has both a text and a file part", () => {
    // Real ID shapes from a live OpenCode DB: same millisecond, adjacent
    // counters. The text part (…c001) must win over the file part (…c002).
    const textPart: ChatMessagePart = {
      id: "prt_b9634c88c001aaaaaaaaaaaaaa",
      sessionID: "main-session",
      messageID: "message-multi-part",
      type: "text",
      text: "typed message",
    };
    const filePart: ChatMessagePart = {
      id: "prt_b9634c88c002aaaaaaaaaaaaaa",
      sessionID: "main-session",
      messageID: "message-multi-part",
      type: "file",
      mime: "application/pdf",
      filename: "report.pdf",
    };
    const parts = [structuredClone(textPart), structuredClone(filePart)];

    const sessionStartPart = insertSyntheticTextPart(
      parts,
      "session context",
      "sessionStart",
    );
    const workflowStatePart = insertSyntheticTextPart(
      parts,
      "workflow context",
      "workflowState",
    );

    for (const ordinary of [textPart, filePart]) {
      expect(sessionStartPart.id < ordinary.id).toBe(true);
      expect(workflowStatePart.id < ordinary.id).toBe(true);
    }

    // The sort-below assertions above are necessary but NOT sufficient with
    // this exact fixture: they still pass even if findIdentitySourcePart
    // picks the file part (the *maximum*-ordinal ordinary part) instead of
    // the text part, because the wrongly-sourced workflowState ordinal then
    // collides with the text part's own 12-hex ordinal, and the numeric
    // slot digit "1" still sorts below the "a" tail character by ASCII
    // luck. Pin the exact ordinal derived from the text part (the minimum)
    // so an inverted comparator is actually caught:
    // sessionStart = 0xb9634c88c001 - 2 = 0xb9634c88bfff,
    // workflowState = 0xb9634c88c001 - 1 = 0xb9634c88c000.
    expect(sessionStartPart.id.slice(0, 17)).toBe("prt_b9634c88bfff0");
    expect(workflowStatePart.id.slice(0, 17)).toBe("prt_b9634c88c0001");
  });
});

function setupTrellisProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "trellis-opencode-264-"));
  const taskDir = join(dir, ".trellis", "tasks", "demo-task");
  mkdirSync(taskDir, { recursive: true });
  mkdirSync(join(dir, ".trellis", ".runtime", "sessions"), { recursive: true });
  writeFileSync(
    join(taskDir, "prd.md"),
    "# Demo PRD\n\nGoal: verify injection.",
  );
  writeFileSync(join(taskDir, "implement.jsonl"), "");
  writeFileSync(join(taskDir, "check.jsonl"), "");
  writeFileSync(
    join(dir, ".trellis", "workflow.md"),
    [
      "# Workflow",
      "",
      "[workflow-state:in_progress]",
      "Active task: <task path>. Dispatch trellis-implement or trellis-check.",
      "[/workflow-state:in_progress]",
      "",
    ].join("\n"),
  );
  return dir;
}

function writeSessionFile(dir: string, key: string, taskRef: string): void {
  const file = join(dir, ".trellis", ".runtime", "sessions", `${key}.json`);
  writeFileSync(file, JSON.stringify({ current_task: taskRef }, null, 2));
}

describe("opencode TrellisContext single-session fallback", () => {
  let dir: string;

  beforeEach(() => {
    dir = setupTrellisProject();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the only session file when exactly one exists", () => {
    writeSessionFile(dir, "opencode_sole", ".trellis/tasks/demo-task");
    const ctx = new TrellisContext(dir);
    const active = ctx.getActiveTask({ sessionID: "missing-key" });

    expect(active.taskPath).toBe(".trellis/tasks/demo-task");
    expect(active.source).toBe("session-fallback:opencode_sole");
    expect(active.stale).toBe(false);
  });

  it("refuses to guess when two or more session files exist", () => {
    writeSessionFile(dir, "opencode_a", ".trellis/tasks/demo-task");
    writeSessionFile(dir, "opencode_b", ".trellis/tasks/demo-task");
    const ctx = new TrellisContext(dir);
    const active = ctx.getActiveTask({ sessionID: "missing-key" });

    expect(active.taskPath).toBeNull();
    expect(active.source).toBe("none");
  });

  it("returns no task when zero session files exist (Python parity)", () => {
    // sessions/ exists from setupTrellisProject but contains no files
    const ctx = new TrellisContext(dir);
    const active = ctx.getActiveTask({ sessionID: "missing-key" });

    expect(active.taskPath).toBeNull();
    expect(active.source).toBe("none");
  });

  it("prefers an exact context-key match over the fallback", () => {
    writeSessionFile(dir, "opencode_session_exact", ".trellis/tasks/demo-task");
    writeSessionFile(dir, "opencode_other", ".trellis/tasks/demo-task");
    const ctx = new TrellisContext(dir);
    const active = ctx.getActiveTask({ sessionID: "exact" });

    // sessionID="exact" maps to "opencode_exact" via buildContextKey; we
    // wrote "opencode_session_exact" so the exact lookup misses, but the
    // presence of ≥2 files means fallback should also refuse — proving
    // exact match is attempted first.
    expect(active.taskPath).toBeNull();
  });
});

describe("opencode messages.transform injection (issue #553)", () => {
  let dir: string;

  beforeEach(() => {
    dir = setupTrellisProject();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function loadSessionHooks(): Promise<TransformHooks> {
    return (await sessionStartPlugin({ directory: dir })) as TransformHooks;
  }

  async function loadWorkflowHooks(): Promise<TransformHooks> {
    return (await injectWorkflowStatePlugin({
      directory: dir,
    })) as TransformHooks;
  }

  function ephemeralTexts(message: TransformMessage): string[] {
    return message.parts
      .filter(
        (part) => part.synthetic === true && typeof part.text === "string",
      )
      .map((part) => part.text as string);
  }

  it("injects both plugins onto the latest user message without mutating history", async () => {
    for (const order of [
      ["sessionStart", "workflowState"],
      ["workflowState", "sessionStart"],
    ]) {
      const earlier = userTurn("old prompt", {
        sessionID: "main-session",
        messageID: "message-old",
      });
      const ordinary = createUserTextPart(
        "ordinary user prompt",
        "main-session",
        "message-new",
      );
      ordinary.metadata = { user: { preserved: true } };
      const latest: TransformMessage = {
        info: { role: "user", sessionID: "main-session", agent: "build" },
        parts: [structuredClone(ordinary)],
      };
      const originalEarlierParts = earlier.parts;
      const originalLatestParts = latest.parts;
      const messages: TransformMessage[] = [
        earlier,
        { info: { role: "assistant", sessionID: "main-session" }, parts: [] },
        latest,
      ];
      const sessionHooks = await loadSessionHooks();
      const workflowHooks = await loadWorkflowHooks();

      for (const kind of order) {
        const hooks = kind === "sessionStart" ? sessionHooks : workflowHooks;
        await hooks[MESSAGES_TRANSFORM_HOOK]({}, { messages });
      }

      expect(messages[0]).toBe(earlier);
      expect(messages[0].parts).toBe(originalEarlierParts);
      expect(originalLatestParts).toEqual([ordinary]);
      expect(messages[2]).not.toBe(latest);
      const texts = ephemeralTexts(messages[2]);
      expect(texts.some((text) => text.startsWith("<session-context>"))).toBe(
        true,
      );
      expect(texts.some((text) => text.startsWith("<workflow-state>"))).toBe(
        true,
      );
      expect(messages[2].parts.at(-1)).toEqual(ordinary);
    }
  });

  it("prepends ephemeral text onto attachment-only latest user messages", async () => {
    const attachment: ChatMessagePart = {
      id: "prt_000000000010abcdefghijklmn",
      sessionID: "main-session",
      messageID: "attachment-only-message",
      type: "file",
      mime: "application/pdf",
      filename: "report.pdf",
    };
    const latest: TransformMessage = {
      info: { role: "user", sessionID: "main-session", agent: "build" },
      parts: [structuredClone(attachment)],
    };
    const originalParts = latest.parts;
    const messages = [latest];
    const sessionHooks = await loadSessionHooks();
    const workflowHooks = await loadWorkflowHooks();
    await workflowHooks[MESSAGES_TRANSFORM_HOOK]({}, { messages });
    await sessionHooks[MESSAGES_TRANSFORM_HOOK]({}, { messages });

    expect(originalParts).toEqual([attachment]);
    const texts = ephemeralTexts(messages[0]);
    expect(texts.some((text) => text.startsWith("<session-context>"))).toBe(
      true,
    );
    expect(texts.some((text) => text.startsWith("<workflow-state>"))).toBe(
      true,
    );
    expect(messages[0].parts.at(-1)).toEqual(attachment);
  });

  it("injects without a persisted part identity", async () => {
    const sessionHooks = await loadSessionHooks();
    const workflowHooks = await loadWorkflowHooks();
    const latest: TransformMessage = {
      info: { role: "user", sessionID: "main-session", agent: "build" },
      parts: [{ type: "text", text: "original" }],
    };
    const originalParts = latest.parts;
    const messages = [latest];
    await sessionHooks[MESSAGES_TRANSFORM_HOOK]({}, { messages });
    await workflowHooks[MESSAGES_TRANSFORM_HOOK]({}, { messages });
    expect(originalParts).toEqual([{ type: "text", text: "original" }]);
    expect(ephemeralTexts(messages[0]).length).toBe(2);
    expect(messages[0].parts.at(-1)).toEqual({
      type: "text",
      text: "original",
    });
  });

  it("checks the skip keyword only in ordinary user text", async () => {
    const hooks = await loadWorkflowHooks();
    const ordinary = createUserTextPart("ordinary prompt");
    const latest: TransformMessage = {
      info: { role: "user", sessionID: "main-session", agent: "build" },
      parts: [
        {
          type: "text",
          text: "machine context containing no-trellis",
          synthetic: true,
        },
        structuredClone(ordinary),
      ],
    };
    const messages = [latest];
    await hooks[MESSAGES_TRANSFORM_HOOK]({}, { messages });
    expect(
      ephemeralTexts(messages[0]).some((text) =>
        text.startsWith("<workflow-state>"),
      ),
    ).toBe(true);
    expect(messages[0].parts.at(-1)).toEqual(ordinary);
  });

  it("keeps both plugins disabled by their existing environment gates", async () => {
    const sessionHooks = await loadSessionHooks();
    const workflowHooks = await loadWorkflowHooks();
    const cases = [
      ["TRELLIS_HOOKS", "0"],
      ["TRELLIS_DISABLE_HOOKS", "1"],
      ["OPENCODE_NON_INTERACTIVE", "1"],
    ] as const;

    for (const [key, value] of cases) {
      const previous = process.env[key];
      process.env[key] = value;
      try {
        for (const hooks of [sessionHooks, workflowHooks]) {
          const latest = userTurn("original");
          const original = latest.parts;
          const messages = [latest];
          await hooks[MESSAGES_TRANSFORM_HOOK]({}, { messages });
          expect(messages[0]).toBe(latest);
          expect(messages[0].parts).toBe(original);
        }
      } finally {
        if (previous === undefined) Reflect.deleteProperty(process.env, key);
        else process.env[key] = previous;
      }
    }
  });

  it("inject-workflow-state.js still injects breadcrumb for main-session turns", async () => {
    const hooks = await loadWorkflowHooks();
    const latest = userTurn("user prompt");
    const original = latest.parts[0];
    const messages = [latest];
    await hooks[MESSAGES_TRANSFORM_HOOK]({}, { messages });
    expect(messages[0].parts[0].text).toContain("<workflow-state>");
    expect(messages[0].parts[0].synthetic).toBe(true);
    expect(messages[0].parts[1]).toEqual(original);
  });

  it("inject-workflow-state.js skips injection when the prompt contains the default skip keyword", async () => {
    const hooks = await loadWorkflowHooks();
    const latest = userTurn("no-trellis what does this regex do");
    const original = latest.parts;
    const messages = [latest];
    await hooks[MESSAGES_TRANSFORM_HOOK]({}, { messages });
    expect(messages[0]).toBe(latest);
    expect(messages[0].parts).toBe(original);
  });

  it("inject-workflow-state.js does not skip on 'no-trellisfoo' (word-boundary negative)", async () => {
    const hooks = await loadWorkflowHooks();
    const latest = userTurn("no-trellisfoo is a strange word");
    const messages = [latest];
    await hooks[MESSAGES_TRANSFORM_HOOK]({}, { messages });
    expect(messages[0].parts[0].text).toContain("<workflow-state>");
  });

  it("inject-workflow-state.js honors a custom prompt_injection.skip_keyword", async () => {
    writeFileSync(
      join(dir, ".trellis", "config.yaml"),
      ["prompt_injection:", '  skip_keyword: "off-topic"'].join("\n"),
    );
    const hooks = await loadWorkflowHooks();

    const skipped = userTurn("off-topic question");
    const skippedMessages = [skipped];
    await hooks[MESSAGES_TRANSFORM_HOOK]({}, { messages: skippedMessages });
    expect(skippedMessages[0]).toBe(skipped);

    const notSkipped = userTurn("no-trellis question", {
      sessionID: "main-session-2",
      messageID: "message-custom-keyword",
    });
    const notSkippedMessages = [notSkipped];
    await hooks[MESSAGES_TRANSFORM_HOOK]({}, { messages: notSkippedMessages });
    expect(notSkippedMessages[0].parts[0].text).toContain("<workflow-state>");
  });

  it('inject-workflow-state.js disables the escape hatch with skip_keyword: ""', async () => {
    writeFileSync(
      join(dir, ".trellis", "config.yaml"),
      ["prompt_injection:", '  skip_keyword: ""'].join("\n"),
    );
    const hooks = await loadWorkflowHooks();
    const latest = userTurn("no-trellis question");
    const messages = [latest];
    await hooks[MESSAGES_TRANSFORM_HOOK]({}, { messages });
    expect(messages[0].parts[0].text).toContain("<workflow-state>");
  });
});

describe("opencode ephemeral transform helpers", () => {
  it("clones only the latest user message when prepending text", () => {
    const earlier = userTurn("old");
    const latest = userTurn("new", { messageID: "message-b" });
    const messages = [
      earlier,
      { info: { role: "assistant" }, parts: [] },
      latest,
    ];
    expect(prependEphemeralText(messages, "ephemeral")).toBe(true);
    expect(messages[0]).toBe(earlier);
    expect(messages[2]).not.toBe(latest);
    expect(latest.parts).toHaveLength(1);
    expect(messages[2].parts[0]).toEqual({
      type: "text",
      text: "ephemeral",
      synthetic: true,
    });
    expect(messages[2].parts[1]).toBe(latest.parts[0]);
  });
});

describe("opencode inject-workflow-state layered default (parity with Python)", () => {
  // End-to-end parity for the personal/team default layers so the JS port
  // cannot silently drift from common/workflow_selection.py. OpenCode plugins
  // expose only a default export (regression #212), so we drive the real
  // experimental.chat.messages.transform handler: with no active task the
  // breadcrumb comes from the resolved workflow file's [workflow-state:no_task]
  // block. Each candidate file carries a distinct marker, so the emitted
  // breadcrumb reveals which file the layered resolver picked. (The per-task
  // pin layer is 467's unchanged code, covered by the Python matrix.)
  let dir: string;

  const noTaskBlock = (marker: string): string =>
    [
      "# Workflow",
      "",
      "[workflow-state:no_task]",
      marker,
      "[/workflow-state:no_task]",
      "",
    ].join("\n");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wf-layered-js-"));
    mkdirSync(join(dir, ".trellis", ".runtime", "sessions"), {
      recursive: true,
    });
    mkdirSync(join(dir, ".trellis", "workflows"), { recursive: true });
    writeFileSync(
      join(dir, ".trellis", "workflow.md"),
      noTaskBlock("GLOBAL_BREADCRUMB"),
    );
    writeFileSync(
      join(dir, ".trellis", "workflows", "tdd.md"),
      noTaskBlock("TDD_BREADCRUMB"),
    );
    writeFileSync(
      join(dir, ".trellis", "workflows", "native.md"),
      noTaskBlock("NATIVE_BREADCRUMB"),
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function breadcrumb(): Promise<string> {
    const hooks = (await injectWorkflowStatePlugin({
      directory: dir,
    })) as TransformHooks;
    // The breadcrumb arrives as its own synthetic part rather than being
    // prepended to the user's text (#524), and insertSyntheticTextPart refuses
    // to run unless an ordinary part carries a persisted identity — so the
    // prompt has to be a realistic OpenCode part, not a bare {type,text}.
    const latest = userTurn("user prompt");
    const messages = [latest];
    await hooks[MESSAGES_TRANSFORM_HOOK]({}, { messages });
    return messages[0].parts
      .filter((part) => part.text !== undefined)
      .map((part) => part.text)
      .join("\n\n");
  }

  it("no config -> global breadcrumb", async () => {
    expect(await breadcrumb()).toContain("GLOBAL_BREADCRUMB");
  });

  it("team default routes the breadcrumb to the team variant", async () => {
    writeFileSync(
      join(dir, ".trellis", "config.yaml"),
      'default_workflow: "tdd"  # team default\n',
    );
    const text = await breadcrumb();
    expect(text).toContain("TDD_BREADCRUMB");
    expect(text).not.toContain("GLOBAL_BREADCRUMB");
  });

  it("personal override outranks the team default", async () => {
    writeFileSync(
      join(dir, ".trellis", "config.yaml"),
      "default_workflow: tdd\n",
    );
    writeFileSync(
      join(dir, ".trellis", ".developer"),
      "name=x\nworkflow=native\n",
    );
    const text = await breadcrumb();
    expect(text).toContain("NATIVE_BREADCRUMB");
    expect(text).not.toContain("TDD_BREADCRUMB");
  });

  it("commented default_workflow is ignored -> global breadcrumb", async () => {
    writeFileSync(
      join(dir, ".trellis", "config.yaml"),
      "# default_workflow: tdd\n",
    );
    expect(await breadcrumb()).toContain("GLOBAL_BREADCRUMB");
  });

  it("team default naming a missing file falls through to global", async () => {
    writeFileSync(
      join(dir, ".trellis", "config.yaml"),
      "default_workflow: nope\n",
    );
    expect(await breadcrumb()).toContain("GLOBAL_BREADCRUMB");
  });

  it(".developer with only name= is backward-safe -> global breadcrumb", async () => {
    writeFileSync(join(dir, ".trellis", ".developer"), "name=tommy\n");
    expect(await breadcrumb()).toContain("GLOBAL_BREADCRUMB");
  });
});
