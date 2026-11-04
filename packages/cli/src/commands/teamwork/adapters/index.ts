/**
 * Worker adapter factory.
 *
 * Each provider (claude, codex, future: opencode, gemini, …) implements a
 * `WorkerAdapter` describing how to:
 *
 *   - launch the worker CLI (`buildArgs`)
 *   - create a per-worker mutable context (`createCtx`)
 *   - optionally run a handshake before user messages flow (`handshake`)
 *   - report readiness for user input (`isReady`)
 *   - parse a line of stdout into Teamwork Session events (`parseLine`)
 *   - encode a Teamwork Session user message for stdin (`encodeUserMessage`)
 *
 * `getAdapter(name)` returns the right adapter. supervisor.ts and spawn.ts
 * stay provider-agnostic — adding a new provider means writing a new
 * `<name>.ts` adapter and registering it here.
 */

import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import { z } from "zod";

import type { ReasoningEffort } from "../profiles.js";
import { createAcpAdapter } from "./acp.js";

import {
  buildClaudeArgs,
  encodeClaudeInterruptMessage,
  encodeClaudeUserMessage,
  parseClaudeLine,
} from "./claude.js";
import {
  buildCodexArgs,
  buildCodexThreadStartParams,
  createCodexCtx,
  encodeCodexInterruptMessage,
  encodeCodexRequest,
  encodeCodexUserMessage,
  parseCodexLine,
  type CodexCtx,
  type CodexSandboxMode,
} from "./codex.js";
import type { ParseResult } from "./types.js";

// `Provider` is derived from REGISTRY at the bottom of this file, so
// adding a new adapter to REGISTRY automatically widens the type and
// the CLI accepts the new value without further edits.

export type WorkerChild = ChildProcessByStdio<Writable, Readable, Readable>;

/** Per-worker handshake / RPC state. Each adapter owns its shape. */
export type AdapterCtx = unknown;

export interface SupervisorView {
  /** Args passed to `buildArgs`. Adapters read what they need (model, resume, systemPrompt). */
  resume?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  options?: Record<string, string | number | boolean>;
  systemPrompt: string;
  /**
   * Path to a file containing the system prompt (written by the supervisor).
   * When set, adapters that support file-based prompt flags (claude:
   * `--append-system-prompt-file`) SHOULD use it instead of inlining the
   * prompt on the command line — long command lines exceed OS limits
   * (Windows CreateProcess: 32,767 chars → spawn ENAMETOOLONG).
   */
  systemPromptFile?: string;
  cwd: string;
  /** Codex-only: overrides the `thread/start` sandbox mode (default `workspace-write`). */
  sandbox?: CodexSandboxMode;
}

export interface WorkerAdapter<Ctx = AdapterCtx> {
  /** Display + binary name. */
  readonly provider: Provider;
  readonly transport: "claude-cli" | "codex-app-server" | "acp";
  /** Build the CLI args used to start the teammate process. */
  buildArgs(view: SupervisorView): string[];
  /** Fresh per-teammate context (e.g. JSON-RPC pending map). */
  createCtx(): Ctx;
  /** SDK transports own stdout and expose their normalized event stream here. */
  output?(child: WorkerChild, ctx: Ctx): Readable;
  deliverMessage?(
    text: string,
    ctx: Ctx,
    interrupt: boolean,
  ): void | Promise<void>;
  /**
   * Optional one-time setup AFTER the worker is spawned and stdout is piped,
   * BEFORE user messages flow. Adapters that need handshake (codex) do their
   * `initialize` + `thread/start` here. Claude has none.
   */
  handshake?(args: {
    child: WorkerChild;
    ctx: Ctx;
    view: SupervisorView;
  }): Promise<void>;
  /**
   * Returns true when the adapter can accept a user message via stdin.
   * Codex requires the handshake to have populated `threadId`; Claude is
   * always ready immediately after spawn.
   */
  isReady(ctx: Ctx): boolean;
  /** Parse one line of worker stdout into Teamwork Session events + side effects. */
  parseLine(line: string, ctx: Ctx): ParseResult;
  /**
   * Encode a Teamwork Session user message into the bytes that should be
   * written to the worker's stdin (may include multiple lines).
   */
  encodeUserMessage(text: string, ctx: Ctx): string;
  /**
   * Encode an interrupt redirect. Adapters may add provider-specific
   * control frames before the replacement user message.
   */
  encodeInterruptMessage(text: string, ctx: Ctx): string;
}

/** Claude adapter — stream-json over stdio, no handshake. */
const claudeAdapter: WorkerAdapter<undefined> = {
  provider: "claude",
  transport: "claude-cli",
  buildArgs(view) {
    return buildClaudeArgs({
      resumeSessionId: view.resume,
      model: view.model,
      reasoningEffort: view.reasoningEffort,
      systemPrompt: view.systemPrompt,
      systemPromptFile: view.systemPromptFile,
    });
  },
  createCtx() {
    return undefined;
  },
  isReady() {
    return true;
  },
  parseLine(line) {
    return parseClaudeLine(line);
  },
  encodeUserMessage(text) {
    return encodeClaudeUserMessage(text);
  },
  encodeInterruptMessage(text) {
    return encodeClaudeInterruptMessage(text);
  },
};

/** Codex adapter — JSON-RPC 2.0 via `app-server`, requires handshake. */
interface CodexRpcContext extends CodexCtx {
  waiters: Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >;
  child?: WorkerChild;
  turnId?: string;
  turnEnd?: Promise<void>;
  finishTurn?: () => void;
  interrupting?: boolean;
  startPending?: Promise<void>;
}

async function codexRequest(
  child: WorkerChild,
  ctx: CodexRpcContext,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const frame = encodeCodexRequest(
    ctx,
    method,
    params,
    method === "initialize" || method === "thread/start" ? method : "other",
  );
  return waitCodexFrame(child, ctx, frame, method);
}

function waitCodexFrame(
  child: WorkerChild,
  ctx: CodexRpcContext,
  frame: { id: number; line: string },
  method: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      child.off("exit", fail);
      ctx.waiters.delete(frame.id);
      ctx.pending.delete(frame.id);
    };
    const fail = (): void => {
      cleanup();
      reject(new Error(`Codex ${method} connection closed`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Codex ${method} timed out after 30s`));
    }, 30_000);
    child.once("exit", fail);
    ctx.waiters.set(frame.id, {
      resolve: (value) => {
        cleanup();
        resolve(value);
      },
      reject: (error) => {
        cleanup();
        reject(error);
      },
    });
    child.stdin.write(frame.line);
  });
}

const codexModelPage = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      model: z.string().optional(),
      supportedReasoningEfforts: z
        .array(z.object({ reasoningEffort: z.string() }))
        .optional(),
    }),
  ),
  nextCursor: z.string().nullable().optional(),
});

const codexAdapter: WorkerAdapter<CodexRpcContext> = {
  provider: "codex",
  transport: "codex-app-server",
  buildArgs(view) {
    return buildCodexArgs({
      model: view.model,
      reasoningEffort: view.reasoningEffort,
    });
  },
  createCtx() {
    return { ...createCodexCtx(), waiters: new Map() };
  },
  async handshake({ child, ctx, view }) {
    ctx.child = child;
    await codexRequest(child, ctx, "initialize", {
      clientInfo: { name: "trellis-teamwork", version: "1" },
      capabilities: {},
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`,
    );
    if (view.model) {
      let cursor: string | undefined;
      let matched = false;
      const seen = new Set<string>();
      do {
        const page = codexModelPage.parse(
          await codexRequest(child, ctx, "model/list", {
            limit: 100,
            includeHidden: false,
            ...(cursor ? { cursor } : {}),
          }),
        );
        const model = page.data.find(
          (item) => item.id === view.model || item.model === view.model,
        );
        if (model) {
          if (
            view.reasoningEffort &&
            !model.supportedReasoningEfforts?.some(
              (effort) => effort.reasoningEffort === view.reasoningEffort,
            )
          )
            throw new Error(
              `Codex model '${view.model}' does not advertise effort '${view.reasoningEffort}'`,
            );
          matched = true;
          break;
        }
        cursor = page.nextCursor ?? undefined;
        if (cursor && seen.has(cursor))
          throw new Error("Codex model/list repeated a cursor");
        if (cursor) seen.add(cursor);
      } while (cursor);
      if (!matched)
        throw new Error(`Codex model '${view.model}' is unavailable`);
    }
    const params = buildCodexThreadStartParams(
      view.cwd,
      view.systemPrompt,
      view.sandbox,
      view.model,
      view.reasoningEffort,
    );
    if (view.resume) params.threadId = view.resume;
    const response = z
      .object({ thread: z.object({ id: z.string().min(1) }) })
      .parse(
        await codexRequest(
          child,
          ctx,
          view.resume ? "thread/resume" : "thread/start",
          params,
        ),
      );
    ctx.threadId = response.thread.id;
  },
  isReady(ctx) {
    return Boolean(ctx.threadId);
  },
  parseLine(line, ctx) {
    const suppress = ctx.interrupting;
    let method: unknown;
    try {
      method = (JSON.parse(line) as { method?: unknown } | null)?.method;
    } catch {
      /* The parser reports malformed input below. */
    }
    if (method === "turn/completed" || method === "turn/aborted") {
      ctx.finishTurn?.();
      ctx.finishTurn = undefined;
      ctx.turnId = undefined;
    }
    const result = parseCodexLine(line, ctx);
    for (const response of result.side?.resolved ?? []) {
      const waiter = ctx.waiters.get(response.id);
      if (response.error)
        waiter?.reject(new Error(JSON.stringify(response.error)));
      else waiter?.resolve(response.result);
    }
    return suppress ? { ...result, events: [] } : result;
  },
  async deliverMessage(text, ctx, interrupt) {
    const child = ctx.child;
    if (!child) throw new Error("Codex transport is not ready");
    if (interrupt) {
      await ctx.startPending;
      if (ctx.turnId && ctx.turnEnd) {
        ctx.interrupting = true;
        try {
          await codexRequest(child, ctx, "turn/interrupt", {
            threadId: ctx.threadId,
            turnId: ctx.turnId,
          });
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              ctx.turnEnd,
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () =>
                    reject(
                      new Error(
                        "Codex interrupt did not reach a terminal turn",
                      ),
                    ),
                  30_000,
                );
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        } finally {
          ctx.interrupting = false;
        }
      }
    } else if (ctx.turnId)
      throw new Error("Codex prompt turn is already active");
    ctx.turnEnd = new Promise((resolve) => {
      ctx.finishTurn = resolve;
    });
    ctx.startPending = waitCodexFrame(
      child,
      ctx,
      encodeCodexUserMessage(ctx, text),
      "turn/start",
    ).then((response) => {
      const turn = z
        .object({ turn: z.object({ id: z.string().min(1) }) })
        .parse(response);
      if (ctx.finishTurn) ctx.turnId = turn.turn.id;
    });
    await ctx.startPending;
  },
  encodeUserMessage(text, ctx) {
    return encodeCodexUserMessage(ctx, text).line;
  },
  encodeInterruptMessage(text, ctx) {
    return encodeCodexInterruptMessage(ctx, text).line;
  },
};

/**
 * Single source of truth for known providers. Adding a new adapter:
 *   1. write `adapters/<name>.ts`
 *   2. add `<name>: <name>Adapter` here
 * No other file in the runtime needs to change.
 */
const REGISTRY = {
  claude: claudeAdapter,
  codex: codexAdapter,
  copilot: createAcpAdapter("copilot"),
  dsh: createAcpAdapter("dsh"),
} as const;

export type Provider = keyof typeof REGISTRY;

/** Runtime list of registered providers — used by CLI validation. */
export function listProviders(): Provider[] {
  return Object.keys(REGISTRY) as Provider[];
}

export function isProvider(value: string): value is Provider {
  return Object.hasOwn(REGISTRY, value);
}

export function getAdapter(provider: Provider): WorkerAdapter<AdapterCtx> {
  const a = REGISTRY[provider];
  if (!a) {
    throw new Error(
      `Unknown provider '${provider}' (registered: ${listProviders().join(", ")})`,
    );
  }
  return a as WorkerAdapter<AdapterCtx>;
}
