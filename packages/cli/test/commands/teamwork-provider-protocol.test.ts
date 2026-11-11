import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { createAcpAdapter } from "../../src/commands/teamwork/adapters/acp.js";
import {
  getAdapter,
  type WorkerChild,
} from "../../src/commands/teamwork/adapters/index.js";
import type { ParseResult } from "../../src/commands/teamwork/adapters/types.js";

interface Frame {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function wire(
  handler: (frame: Frame, reply: (result: unknown) => void) => void,
) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  }) as WorkerChild;
  const frames: Frame[] = [];
  const lines = createInterface({ input: child.stdin });
  const send = (frame: unknown): void => {
    child.stdout.write(`${JSON.stringify(frame)}\n`);
  };
  lines.on("line", (line) => {
    const frame = JSON.parse(line) as Frame;
    frames.push(frame);
    handler(frame, (result) => send({ jsonrpc: "2.0", id: frame.id, result }));
  });
  disposers.push(() => {
    lines.close();
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    child.emit("exit", 0);
  });
  return { child, frames, send };
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error("protocol fixture did not reach the expected state");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

describe("real provider transport contracts", () => {
  it.each(["copilot", "dsh"] as const)(
    "%s keeps interim text in progress and only emits the terminal answer",
    async (provider) => {
      let completePrompt: ((result: unknown) => void) | undefined;
      const fixture = wire((frame, reply) => {
        if (frame.method === "initialize")
          reply({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] });
        if (frame.method === "session/new") reply({ sessionId: "session-1", configOptions: [] });
        if (frame.method === "session/prompt") completePrompt = reply;
      });
      const adapter = createAcpAdapter(provider);
      const ctx = adapter.createCtx();
      const results: ParseResult[] = [];
      const lines = createInterface({ input: adapter.output?.(fixture.child, ctx) });
      lines.on("line", (line) => results.push(adapter.parseLine(line, ctx)));
      disposers.push(() => { ctx.connection?.close(); lines.close(); });
      await adapter.handshake?.({ child: fixture.child, ctx, view: { cwd: "/project" } });
      await adapter.deliverMessage?.("review", ctx, false);
      await until(() => !!completePrompt);
      const notify = (update: unknown): void => fixture.send({ jsonrpc: "2.0", method: "session/update",
        params: { sessionId: "session-1", update } });
      notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Checking the code." } });
      notify({ sessionUpdate: "tool_call", toolCallId: "read-1", title: "Read source", kind: "read", status: "in_progress" });
      notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: '{"answer":' } });
      notify({ sessionUpdate: "tool_call_update", toolCallId: "read-1", status: "completed" });
      notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: '"reviewed"}' } });
      completePrompt?.({ stopReason: "end_turn" });
      await until(() => results.some((r) => r.events.some((e) => e.kind === "done")));
      const events = results.flatMap((r) => r.events);
      expect(events.filter((e) => e.kind === "message")).toEqual([
        { kind: "message", payload: { text: '{"answer":"reviewed"}' } },
      ]);
      expect(JSON.stringify(events.filter((e) => e.kind === "progress"))).toContain("Checking the code.");
    },
  );

  it.each(["copilot", "dsh"] as const)(
    "%s uses SDK config negotiation and waits for cancellation confirmation",
    async (provider) => {
      let completePrompt: ((result: unknown) => void) | undefined;
      let promptCount = 0;
      const options = [
        {
          id: "model",
          name: "Model",
          type: "select",
          currentValue: "old",
          options: [
            { value: "old", name: "Old" },
            { value: "chosen", name: "Chosen" },
          ],
        },
        {
          id: "reasoning_effort",
          name: "Effort",
          type: "select",
          currentValue: "high",
          options: [
            { value: "high", name: "High" },
            { value: "xhigh", name: "Extra" },
          ],
        },
      ];
      const fixture = wire((frame, reply) => {
        if (frame.method === "initialize")
          reply({
            protocolVersion: 1,
            agentCapabilities: { loadSession: true },
            authMethods: [],
          });
        if (frame.method === "session/new")
          reply({ sessionId: "session-1", configOptions: options });
        if (frame.method === "session/load") reply({ configOptions: options });
        if (frame.method === "session/set_config_option") {
          const option = options.find(
            (item) => item.id === frame.params?.configId,
          );
          if (option) option.currentValue = String(frame.params?.value);
          reply({ configOptions: options });
        }
        if (frame.method === "session/prompt") {
          promptCount++;
          completePrompt = reply;
        }
      });
      const adapter = createAcpAdapter(provider);
      const ctx = adapter.createCtx();
      const results: ParseResult[] = [];
      const lines = createInterface({
        input: adapter.output?.(fixture.child, ctx),
      });
      lines.on("line", (line) => results.push(adapter.parseLine(line, ctx)));
      disposers.push(() => {
        ctx.connection?.close();
        lines.close();
      });
      await adapter.handshake?.({
        child: fixture.child,
        ctx,
        view: {
          cwd: "/project",
          systemPrompt: "精确角色指令".repeat(60_000),
          model: "chosen",
          reasoningEffort: "xhigh",
        },
      });
      expect(adapter.isReady(ctx)).toBe(true);
      fixture.send({
        jsonrpc: "2.0",
        id: 700,
        method: "session/request_permission",
        params: {
          sessionId: "session-1",
          toolCall: { toolCallId: "tool-1", title: "Bounded tool request" },
          options: [
            { kind: "reject_once", optionId: "deny", name: "Deny" },
            { kind: "allow_once", optionId: "allow", name: "Allow" },
          ],
        },
      });
      await until(() =>
        fixture.frames.some(
          (frame) => frame.id === 700 && frame.result !== undefined,
        ),
      );
      expect(fixture.frames.find((frame) => frame.id === 700)?.result).toEqual({
        outcome: { outcome: "selected", optionId: "allow" },
      });
      expect(options.map((option) => option.currentValue)).toEqual([
        "chosen",
        "xhigh",
      ]);
      await adapter.deliverMessage?.('任务数据 "role"\n---', ctx, false);
      await until(() => promptCount === 1);
      const blocks = fixture.frames.find(
        (frame) => frame.method === "session/prompt",
      )?.params?.prompt;
      expect(blocks).toEqual([
        {
          type: "text",
          text: "精确角色指令".repeat(60_000),
        },
        {
          type: "text",
          text: '任务数据 "role"\n---',
        },
      ]);
      const cancelled = completePrompt;
      const redirected = adapter.deliverMessage?.("replacement", ctx, true);
      await until(() =>
        fixture.frames.some((frame) => frame.method === "session/cancel"),
      );
      expect(promptCount).toBe(1);
      cancelled?.({ stopReason: "cancelled" });
      await redirected;
      await until(() => promptCount === 2);
      completePrompt?.({ stopReason: "end_turn" });
      await until(() =>
        results.some((result) =>
          result.events.some((event) => event.kind === "done"),
        ),
      );
      expect(
        results
          .flatMap((result) => result.events)
          .filter((event) => event.kind === "error"),
      ).toEqual([]);
      await until(() => !ctx.turn);
      await adapter.deliverMessage?.("follow-up", ctx, false);
      await until(() => promptCount === 3);
      expect(
        fixture.frames
          .filter((frame) => frame.method === "session/prompt")
          .at(-1)?.params?.prompt,
      ).toEqual([{ type: "text", text: "follow-up" }]);
      completePrompt?.({ stopReason: "end_turn" });
      await until(() => !ctx.turn);
    },
  );

  it.each(["copilot", "dsh"] as const)(
    "%s resumes only through its advertised native method",
    async (provider) => {
      const fixture = wire((frame, reply) => {
        if (frame.method === "initialize")
          reply({
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: provider === "copilot",
              sessionCapabilities: {
                resume: provider === "dsh" ? {} : undefined,
              },
            },
            authMethods: [],
          });
        if (
          frame.method === "session/load" ||
          frame.method === "session/resume"
        )
          reply({ configOptions: [] });
      });
      const adapter = createAcpAdapter(provider);
      const ctx = adapter.createCtx();
      adapter.output?.(fixture.child, ctx).resume();
      disposers.push(() => ctx.connection?.close());
      await adapter.handshake?.({
        child: fixture.child,
        ctx,
        view: {
          cwd: "/project",
          systemPrompt: "role",
          resume: "saved-session",
        },
      });
      expect(ctx.sessionId).toBe("saved-session");
      expect(adapter.isReady(ctx)).toBe(true);
      expect(
        fixture.frames.filter((frame) => frame.method?.startsWith("session/")),
      ).toEqual([
        expect.objectContaining({
          method: provider === "dsh" ? "session/resume" : "session/load",
          params: {
            sessionId: "saved-session",
            cwd: "/project",
            mcpServers: [],
          },
        }),
      ]);
    },
  );

  it("rejects unavailable ACP configuration before accepting task input", async () => {
    const fixture = wire((frame, reply) => {
      if (frame.method === "initialize")
        reply({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] });
      if (frame.method === "session/new")
        reply({ sessionId: "s", configOptions: [] });
    });
    const adapter = createAcpAdapter("copilot");
    const ctx = adapter.createCtx();
    adapter.output?.(fixture.child, ctx).resume();
    disposers.push(() => ctx.connection?.close());
    await expect(
      adapter.handshake?.({
        child: fixture.child,
        ctx,
        view: {
          cwd: "/project",
          systemPrompt: "role",
          model: "unavailable",
        },
      }),
    ).rejects.toThrow(/does not advertise/);
    expect(adapter.isReady(ctx)).toBe(false);
    expect(
      fixture.frames.some((frame) => frame.method === "session/prompt"),
    ).toBe(false);
  });

  it("Codex awaits initialize/model pagination/thread and confirms turn interruption", async () => {
    let interrupted = false;
    const fixture = wire((frame, reply) => {
      if (frame.method === "initialize") reply({});
      if (frame.method === "model/list")
        reply(
          frame.params?.cursor
            ? {
                data: [
                  {
                    id: "chosen",
                    supportedReasoningEfforts: [{ reasoningEffort: "high" }],
                  },
                ],
                nextCursor: null,
              }
            : { data: [], nextCursor: "next" },
        );
      if (frame.method === "thread/start")
        reply({ thread: { id: "thread-1" } });
      if (frame.method === "turn/start")
        reply({ turn: { id: interrupted ? "turn-2" : "turn-1" } });
      if (frame.method === "turn/interrupt") {
        interrupted = true;
        reply({});
      }
    });
    const adapter = getAdapter("codex");
    const ctx = adapter.createCtx();
    const results: ParseResult[] = [];
    const lines = createInterface({ input: fixture.child.stdout });
    lines.on("line", (line) => results.push(adapter.parseLine(line, ctx)));
    disposers.push(() => lines.close());
    await adapter.handshake?.({
      child: fixture.child,
      ctx,
      view: {
        cwd: "/project",
        systemPrompt: "role",
        model: "chosen",
        reasoningEffort: "high",
      },
    });
    await adapter.deliverMessage?.("first", ctx, false);
    const redirect = adapter.deliverMessage?.("replacement", ctx, true);
    await until(() => interrupted);
    expect(
      fixture.frames.filter((frame) => frame.method === "turn/start"),
    ).toHaveLength(1);
    fixture.send({
      jsonrpc: "2.0",
      method: "turn/completed",
      params: { turn: { id: "turn-1", status: "interrupted" } },
    });
    await redirect;
    expect(
      fixture.frames.filter((frame) => frame.method === "turn/start"),
    ).toHaveLength(2);
    expect(
      fixture.frames.find((frame) => frame.method === "turn/interrupt")?.params,
    ).toEqual({ threadId: "thread-1", turnId: "turn-1" });
    expect(
      results
        .flatMap((result) => result.events)
        .filter((event) => event.kind === "done"),
    ).toEqual([]);
  });
});
