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
 *   - parse a line of stdout into channel events (`parseLine`)
 *   - encode a channel user message for stdin (`encodeUserMessage`)
 *
 * `getAdapter(name)` returns the right adapter. supervisor.ts and spawn.ts
 * stay provider-agnostic — adding a new provider means writing a new
 * `<name>.ts` adapter and registering it here.
 */

import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import {
  buildClaudeArgs,
  encodeClaudeInterruptMessage,
  encodeClaudeUserMessage,
  parseClaudeLine,
} from "./claude.js";
import {
  buildCodexArgs,
  buildCodexThreadStartParams,
  cancelCodexResponse,
  createCodexCtx,
  encodeCodexInterruptMessage,
  encodeCodexRequestWithResponse,
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
  /** Build the CLI args used to spawn the worker process. */
  buildArgs(view: SupervisorView): string[];
  /** Fresh per-worker context (e.g. JSON-RPC pending map). */
  createCtx(): Ctx;
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
  /** Parse one line of worker stdout into channel events + side effects. */
  parseLine(line: string, ctx: Ctx): ParseResult;
  /**
   * Encode a channel-side user message into the bytes that should be
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
  buildArgs(view) {
    return buildClaudeArgs({
      resumeSessionId: view.resume,
      model: view.model,
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
const codexAdapter: WorkerAdapter<CodexCtx> = {
  provider: "codex",
  buildArgs(view) {
    return buildCodexArgs({ model: view.model });
  },
  createCtx() {
    return createCodexCtx();
  },
  async handshake({ child, ctx, view }) {
    // 1. initialize
    const init = encodeCodexRequestWithResponse(
      ctx,
      "initialize",
      {
        clientInfo: { name: "trellis-channel", version: "0.1" },
        capabilities: {},
      },
      "initialize",
    );
    child.stdin.write(init.line);
    const initResult = await awaitCodexResponse(
      child,
      ctx,
      init.id,
      init.response,
      "initialize",
    );
    if (!isObject(initResult)) {
      throw new Error("Codex initialize returned an invalid result");
    }

    // 2. complete the app-server handshake before starting a thread
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "initialized",
        params: {},
      }) + "\n",
    );

    const ts = encodeCodexRequestWithResponse(
      ctx,
      "thread/start",
      buildCodexThreadStartParams(view.cwd, view.systemPrompt, view.sandbox),
      "thread/start",
    );
    child.stdin.write(ts.line);
    await awaitCodexResponse(child, ctx, ts.id, ts.response, "thread/start");
    if (!ctx.threadId) {
      throw new Error("Codex thread/start returned no threadId");
    }
  },
  isReady(ctx) {
    return Boolean(ctx.threadId);
  },
  parseLine(line, ctx) {
    return parseCodexLine(line, ctx);
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
} as const;

export type Provider = keyof typeof REGISTRY;

/** Runtime list of registered providers — used by CLI validation. */
export function listProviders(): Provider[] {
  return Object.keys(REGISTRY) as Provider[];
}

export function isProvider(value: string): value is Provider {
  return value in REGISTRY;
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

function awaitCodexResponse(
  child: WorkerChild,
  ctx: CodexCtx,
  id: number,
  response: Promise<unknown>,
  label: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
    };
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      const detail = signal ?? (code === null ? "unknown" : `code ${code}`);
      cancelCodexResponse(
        ctx,
        id,
        new Error(
          `Codex ${label} response interrupted by child exit (${detail})`,
        ),
      );
      finish(() =>
        reject(
          new Error(
            `Codex ${label} response interrupted by child exit (${detail})`,
          ),
        ),
      );
    };
    const onError = (error: Error): void => {
      cancelCodexResponse(ctx, id, error);
      finish(() => reject(error));
    };

    if (child.exitCode !== null || child.signalCode !== null) {
      onExit(child.exitCode, child.signalCode);
      return;
    }
    child.once("exit", onExit);
    child.once("error", onError);
    response.then(
      (result) => finish(() => resolve(result)),
      (error: unknown) =>
        finish(() =>
          reject(error instanceof Error ? error : new Error(String(error))),
        ),
    );
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
