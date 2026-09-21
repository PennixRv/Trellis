import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  buildCodexThreadStartParams,
  createCodexCtx,
  encodeCodexUserMessage,
  parseCodexLine,
  parseCodexSandboxMode,
} from "../../src/commands/channel/adapters/codex.js";
import {
  getAdapter,
  type WorkerChild,
} from "../../src/commands/channel/adapters/index.js";

function parse(line: Record<string, unknown>, ctx = createCodexCtx()) {
  return parseCodexLine(JSON.stringify(line), ctx);
}

class FakeCodexChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
}

function asWorkerChild(child: FakeCodexChild): WorkerChild {
  return child as unknown as WorkerChild;
}

function wireParser(
  child: FakeCodexChild,
  ctx: ReturnType<typeof createCodexCtx>,
): void {
  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf-8");
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      parseCodexLine(buffer.slice(0, newline), ctx);
      buffer = buffer.slice(newline + 1);
    }
  });
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Codex channel adapter", () => {
  it("performs the app-server handshake in response-driven order", async () => {
    const adapter = getAdapter("codex");
    const child = new FakeCodexChild();
    const ctx = adapter.createCtx() as ReturnType<typeof createCodexCtx>;
    wireParser(child, ctx);
    const writes: Record<string, unknown>[] = [];
    child.stdin.on("data", (chunk: Buffer) => {
      writes.push(
        JSON.parse(chunk.toString("utf-8")) as Record<string, unknown>,
      );
    });

    const handshake = adapter.handshake?.({
      child: asWorkerChild(child),
      ctx,
      view: { cwd: "/tmp/project", systemPrompt: "system" },
    });
    await flushMicrotasks();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.method).toBe("initialize");

    child.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: writes[0]?.id, result: {} }) + "\n",
    );
    await flushMicrotasks();
    expect(writes.slice(1, 3)).toEqual([
      { jsonrpc: "2.0", method: "initialized", params: {} },
      expect.objectContaining({ method: "thread/start" }),
    ]);
    expect(writes[1]).not.toHaveProperty("id");

    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: writes[2]?.id,
        result: { thread: { id: "thread-1" } },
      }) + "\n",
    );
    await expect(handshake).resolves.toBeUndefined();
    expect(ctx.threadId).toBe("thread-1");
    expect(ctx.pending.size).toBe(0);
    expect(ctx.responseWaiters.size).toBe(0);
  });

  it("does not start a thread when initialize fails", async () => {
    const adapter = getAdapter("codex");
    const child = new FakeCodexChild();
    const ctx = adapter.createCtx() as ReturnType<typeof createCodexCtx>;
    wireParser(child, ctx);
    const writes: Record<string, unknown>[] = [];
    child.stdin.on("data", (chunk: Buffer) => {
      writes.push(
        JSON.parse(chunk.toString("utf-8")) as Record<string, unknown>,
      );
    });
    const handshake = adapter.handshake?.({
      child: asWorkerChild(child),
      ctx,
      view: { cwd: "/tmp/project", systemPrompt: "system" },
    });
    await flushMicrotasks();
    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: writes[0]?.id,
        error: { code: -32000, message: "not initialized" },
      }) + "\n",
    );
    await expect(handshake).rejects.toThrow(/initialize/);
    expect(writes).toHaveLength(1);
    expect(ctx.pending.size).toBe(0);
    expect(ctx.responseWaiters.size).toBe(0);
  });

  it("does not start a thread when initialize returns a non-object result", async () => {
    const adapter = getAdapter("codex");
    const child = new FakeCodexChild();
    const ctx = adapter.createCtx() as ReturnType<typeof createCodexCtx>;
    wireParser(child, ctx);
    const writes: Record<string, unknown>[] = [];
    child.stdin.on("data", (chunk: Buffer) => {
      writes.push(
        JSON.parse(chunk.toString("utf-8")) as Record<string, unknown>,
      );
    });
    const handshake = adapter.handshake?.({
      child: asWorkerChild(child),
      ctx,
      view: { cwd: "/tmp/project", systemPrompt: "system" },
    });
    await flushMicrotasks();
    child.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: writes[0]?.id, result: null }) +
        "\n",
    );
    await expect(handshake).rejects.toThrow(/invalid result/);
    expect(writes).toHaveLength(1);
    expect(ctx.pending.size).toBe(0);
    expect(ctx.responseWaiters.size).toBe(0);
  });

  it("does not start a thread when the child errors during initialization", async () => {
    const adapter = getAdapter("codex");
    const child = new FakeCodexChild();
    const ctx = adapter.createCtx() as ReturnType<typeof createCodexCtx>;
    wireParser(child, ctx);
    const writes: Record<string, unknown>[] = [];
    child.stdin.on("data", (chunk: Buffer) => {
      writes.push(
        JSON.parse(chunk.toString("utf-8")) as Record<string, unknown>,
      );
    });
    const handshake = adapter.handshake?.({
      child: asWorkerChild(child),
      ctx,
      view: { cwd: "/tmp/project", systemPrompt: "system" },
    });
    await flushMicrotasks();
    child.emit("error", new Error("initialize transport failed"));
    await expect(handshake).rejects.toThrow(/initialize transport failed/);
    expect(writes).toHaveLength(1);
    expect(ctx.pending.size).toBe(0);
    expect(ctx.responseWaiters.size).toBe(0);
  });

  it("fails the handshake when the child exits before a response", async () => {
    const adapter = getAdapter("codex");
    const child = new FakeCodexChild();
    const ctx = adapter.createCtx() as ReturnType<typeof createCodexCtx>;
    wireParser(child, ctx);
    const handshake = adapter.handshake?.({
      child: asWorkerChild(child),
      ctx,
      view: { cwd: "/tmp/project", systemPrompt: "system" },
    });
    await flushMicrotasks();
    child.exitCode = 1;
    child.emit("exit", 1, null);
    await expect(handshake).rejects.toThrow(/child exit/);
    expect(ctx.pending.size).toBe(0);
    expect(ctx.responseWaiters.size).toBe(0);
  });

  it("does not become ready when thread/start fails", async () => {
    const adapter = getAdapter("codex");
    const child = new FakeCodexChild();
    const ctx = adapter.createCtx() as ReturnType<typeof createCodexCtx>;
    wireParser(child, ctx);
    const writes: Record<string, unknown>[] = [];
    child.stdin.on("data", (chunk: Buffer) => {
      writes.push(
        JSON.parse(chunk.toString("utf-8")) as Record<string, unknown>,
      );
    });
    const handshake = adapter.handshake?.({
      child: asWorkerChild(child),
      ctx,
      view: { cwd: "/tmp/project", systemPrompt: "system" },
    });
    await flushMicrotasks();
    child.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: writes[0]?.id, result: {} }) + "\n",
    );
    await flushMicrotasks();
    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: writes[2]?.id,
        error: { code: -32000, message: "thread unavailable" },
      }) + "\n",
    );
    await expect(handshake).rejects.toThrow(/thread\/start/);
    expect(ctx.threadId).toBeUndefined();
    expect(adapter.isReady(ctx)).toBe(false);
    expect(ctx.pending.size).toBe(0);
    expect(ctx.responseWaiters.size).toBe(0);
  });

  it("rejects a malformed thread/start result without becoming ready", async () => {
    const adapter = getAdapter("codex");
    const child = new FakeCodexChild();
    const ctx = adapter.createCtx() as ReturnType<typeof createCodexCtx>;
    wireParser(child, ctx);
    const writes: Record<string, unknown>[] = [];
    child.stdin.on("data", (chunk: Buffer) => {
      writes.push(
        JSON.parse(chunk.toString("utf-8")) as Record<string, unknown>,
      );
    });
    const handshake = adapter.handshake?.({
      child: asWorkerChild(child),
      ctx,
      view: { cwd: "/tmp/project", systemPrompt: "system" },
    });
    await flushMicrotasks();
    child.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: writes[0]?.id, result: {} }) + "\n",
    );
    await flushMicrotasks();
    child.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: writes[2]?.id, result: {} }) + "\n",
    );
    await expect(handshake).rejects.toThrow(/no threadId/);
    expect(ctx.threadId).toBeUndefined();
    expect(adapter.isReady(ctx)).toBe(false);
    expect(ctx.pending.size).toBe(0);
    expect(ctx.responseWaiters.size).toBe(0);
  });

  it("does not become ready when the child errors during thread startup", async () => {
    const adapter = getAdapter("codex");
    const child = new FakeCodexChild();
    const ctx = adapter.createCtx() as ReturnType<typeof createCodexCtx>;
    wireParser(child, ctx);
    const writes: Record<string, unknown>[] = [];
    child.stdin.on("data", (chunk: Buffer) => {
      writes.push(
        JSON.parse(chunk.toString("utf-8")) as Record<string, unknown>,
      );
    });
    const handshake = adapter.handshake?.({
      child: asWorkerChild(child),
      ctx,
      view: { cwd: "/tmp/project", systemPrompt: "system" },
    });
    await flushMicrotasks();
    child.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: writes[0]?.id, result: {} }) +
        "\n",
    );
    await flushMicrotasks();
    child.emit("error", new Error("thread transport failed"));
    await expect(handshake).rejects.toThrow(/thread transport failed/);
    expect(ctx.threadId).toBeUndefined();
    expect(adapter.isReady(ctx)).toBe(false);
    expect(ctx.pending.size).toBe(0);
    expect(ctx.responseWaiters.size).toBe(0);
  });

  it("times out thread/start without becoming ready", async () => {
    vi.useFakeTimers();
    try {
      const adapter = getAdapter("codex");
      const child = new FakeCodexChild();
      const ctx = adapter.createCtx() as ReturnType<typeof createCodexCtx>;
      wireParser(child, ctx);
      const writes: Record<string, unknown>[] = [];
      child.stdin.on("data", (chunk: Buffer) => {
        writes.push(
          JSON.parse(chunk.toString("utf-8")) as Record<string, unknown>,
        );
      });
      const handshake = adapter.handshake?.({
        child: asWorkerChild(child),
        ctx,
        view: { cwd: "/tmp/project", systemPrompt: "system" },
      });
      await flushMicrotasks();
      child.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", id: writes[0]?.id, result: {} }) +
          "\n",
      );
      await flushMicrotasks();
      const rejection = expect(handshake).rejects.toThrow(
        /thread\/start response timed out/,
      );
      await vi.advanceTimersByTimeAsync(30_000);
      await rejection;
      expect(ctx.threadId).toBeUndefined();
      expect(adapter.isReady(ctx)).toBe(false);
      expect(ctx.pending.size).toBe(0);
      expect(ctx.responseWaiters.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out initialize without sending thread/start", async () => {
    vi.useFakeTimers();
    try {
      const adapter = getAdapter("codex");
      const child = new FakeCodexChild();
      const ctx = adapter.createCtx() as ReturnType<typeof createCodexCtx>;
      wireParser(child, ctx);
      const writes: Record<string, unknown>[] = [];
      child.stdin.on("data", (chunk: Buffer) => {
        writes.push(
          JSON.parse(chunk.toString("utf-8")) as Record<string, unknown>,
        );
      });
      const handshake = adapter.handshake?.({
        child: asWorkerChild(child),
        ctx,
        view: { cwd: "/tmp/project", systemPrompt: "system" },
      });
      const rejection = expect(handshake).rejects.toThrow(
        /initialize response timed out/,
      );
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(30_000);
      await rejection;
      expect(writes).toHaveLength(1);
      expect(ctx.pending.size).toBe(0);
      expect(ctx.responseWaiters.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("classifies streamed commentary deltas by item phase", () => {
    const ctx = createCodexCtx();
    parse(
      {
        method: "item/started",
        params: {
          item: {
            type: "agentMessage",
            id: "msg_commentary",
            text: "",
            phase: "commentary",
          },
        },
      },
      ctx,
    );

    const result = parse(
      {
        method: "item/agentMessage/delta",
        params: {
          itemId: "msg_commentary",
          delta: "checking context",
        },
      },
      ctx,
    );

    expect(result.events).toEqual([
      {
        kind: "progress",
        payload: {
          detail: {
            kind: "commentary",
            phase: "commentary",
            stream_id: "msg_commentary",
            text_delta: "checking context",
          },
        },
      },
    ]);
  });

  it("adds stream ids to interleaved output deltas", () => {
    const ctx = createCodexCtx();
    parse(
      {
        method: "item/started",
        params: {
          item: {
            type: "agentMessage",
            id: "msg_final",
            text: "",
            phase: "final_answer",
          },
        },
      },
      ctx,
    );
    parse(
      {
        method: "item/started",
        params: {
          item: {
            type: "agentMessage",
            id: "msg_commentary",
            text: "",
            phase: "commentary",
          },
        },
      },
      ctx,
    );

    const output = parse(
      {
        method: "item/agentMessage/delta",
        params: { itemId: "msg_final", delta: "final " },
      },
      ctx,
    );
    const commentary = parse(
      {
        method: "item/agentMessage/delta",
        params: { itemId: "msg_commentary", delta: "note " },
      },
      ctx,
    );

    expect(output.events[0]).toMatchObject({
      kind: "progress",
      payload: {
        detail: {
          kind: "output",
          phase: "final_answer",
          stream_id: "msg_final",
          text_delta: "final ",
        },
      },
    });
    expect(commentary.events[0]).toMatchObject({
      kind: "progress",
      payload: {
        detail: {
          kind: "commentary",
          phase: "commentary",
          stream_id: "msg_commentary",
          text_delta: "note ",
        },
      },
    });
  });

  it("keeps unclassified deltas backward compatible while adding stream metadata", () => {
    const result = parse({
      method: "item/agentMessage/delta",
      params: { itemId: "msg_unknown", delta: "hello" },
    });

    expect(result.events).toEqual([
      {
        kind: "progress",
        payload: {
          detail: {
            kind: "output",
            stream_id: "msg_unknown",
            text_delta: "hello",
          },
        },
      },
    ]);
  });

  it("emits done after the final answer when turn/completed arrives first", () => {
    const ctx = createCodexCtx();
    const completed = parse({ method: "turn/completed", params: {} }, ctx);
    expect(completed.events).toEqual([]);

    const final = parse(
      {
        method: "item/completed",
        params: {
          item: {
            type: "agentMessage",
            id: "msg_final",
            text: "DONE",
            phase: "final_answer",
          },
        },
      },
      ctx,
    );

    expect(final.events).toEqual([
      {
        kind: "message",
        payload: { text: "DONE" },
      },
      { kind: "done", payload: {} },
    ]);
  });

  it("emits done immediately when turn/completed arrives after the final answer", () => {
    const ctx = createCodexCtx();
    parse(
      {
        method: "item/completed",
        params: {
          item: {
            type: "agentMessage",
            id: "msg_final",
            text: "DONE",
            phase: "final_answer",
          },
        },
      },
      ctx,
    );

    const completed = parse({ method: "turn/completed", params: {} }, ctx);
    expect(completed.events).toEqual([{ kind: "done", payload: {} }]);
  });

  it("emits an error when a turn fails without a final answer", () => {
    const result = parse({
      method: "turn/completed",
      params: {
        turn: {
          status: "failed",
          error: { message: "Model is not available" },
        },
      },
    });

    expect(result.events).toEqual([
      {
        kind: "error",
        payload: { message: "Model is not available" },
      },
    ]);
  });

  it("does not emit duplicate errors for the same failed turn", () => {
    const ctx = createCodexCtx();
    const notification = parse(
      {
        method: "error",
        params: {
          error: { message: "Request failed with status 400" },
          willRetry: false,
        },
      },
      ctx,
    );
    const completed = parse(
      {
        method: "turn/completed",
        params: {
          turn: {
            status: "failed",
            error: { message: "Request failed with status 400" },
          },
        },
      },
      ctx,
    );

    expect(notification.events).toEqual([
      {
        kind: "error",
        payload: { message: "Request failed with status 400" },
      },
    ]);
    expect(completed.events).toEqual([]);
  });

  it("deduplicates failures in reverse order and resets for the next turn", () => {
    const ctx = createCodexCtx();
    const completed = {
      method: "turn/completed",
      params: {
        turn: {
          status: "failed",
          error: { message: "Request failed with status 400" },
        },
      },
    };
    const notification = {
      method: "error",
      params: {
        error: { message: "Request failed with status 400" },
        willRetry: false,
      },
    };

    expect(parse(completed, ctx).events).toHaveLength(1);
    expect(parse(notification, ctx).events).toEqual([]);

    ctx.threadId = "thread-1";
    encodeCodexUserMessage(ctx, "try again");
    expect(parse(notification, ctx).events).toHaveLength(1);
  });

  describe("sandbox override (#413)", () => {
    it("defaults to workspace-write when no sandbox is given", () => {
      const params = buildCodexThreadStartParams("/tmp/proj");
      expect(params.sandbox).toBe("workspace-write");
    });

    it("overrides the sandbox mode when provided", () => {
      const params = buildCodexThreadStartParams(
        "/tmp/proj",
        undefined,
        "danger-full-access",
      );
      expect(params.sandbox).toBe("danger-full-access");
      expect(params.approvalPolicy).toBe("never");
    });

    it("parseCodexSandboxMode accepts documented modes", () => {
      expect(parseCodexSandboxMode(undefined)).toBeUndefined();
      expect(parseCodexSandboxMode("read-only")).toBe("read-only");
      expect(parseCodexSandboxMode("workspace-write")).toBe("workspace-write");
      expect(parseCodexSandboxMode("danger-full-access")).toBe(
        "danger-full-access",
      );
    });

    it("parseCodexSandboxMode rejects unknown values", () => {
      expect(() => parseCodexSandboxMode("yolo")).toThrow(
        /Invalid --sandbox 'yolo'/,
      );
    });
  });
});
