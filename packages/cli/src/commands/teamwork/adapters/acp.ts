import { PassThrough, Readable, Writable } from "node:stream";

import {
  client,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type SessionConfigOption,
  type NewSessionResponse,
  type LoadSessionResponse,
  type ResumeSessionResponse,
  type SetSessionConfigOptionResponse,
} from "@agentclientprotocol/sdk";

import type { SupervisorView, WorkerAdapter, WorkerChild } from "./index.js";
import type { ParseResult } from "./types.js";

export interface AcpContext {
  output: PassThrough;
  connection?: ClientConnection;
  sessionId?: string;
  instructions: string;
  instructionsSent: boolean;
  agentInfo?: { name: string; version: string };
  turn?: Promise<void>;
  text: string;
  generation: number;
  ready: boolean;
}

function emit(ctx: AcpContext, result: ParseResult): void {
  if (!ctx.output.destroyed && !ctx.output.writableEnded)
    ctx.output.write(`${JSON.stringify(result)}\n`);
}

function requireConnection(ctx: AcpContext): ClientConnection {
  if (!ctx.connection || !ctx.sessionId)
    throw new Error("ACP session is not ready");
  return ctx.connection;
}

function values(option: SessionConfigOption): (string | boolean)[] {
  if (option.type === "boolean") return [false, true];
  return option.options.flatMap((entry) =>
    "group" in entry ? entry.options.map((item) => item.value) : [entry.value],
  );
}

async function configure(
  ctx: AcpContext,
  options: SessionConfigOption[],
  requested: Record<string, string | number | boolean>,
): Promise<void> {
  const connection = requireConnection(ctx);
  for (const [key, value] of Object.entries(requested)) {
    const option = options.find((entry) => entry.id === key);
    if (!option || !values(option).includes(value as string | boolean))
      throw new Error(
        `ACP agent does not advertise configuration '${key}=${String(value)}'; ` +
          JSON.stringify({
            stage: "configure",
            agent: ctx.agentInfo ?? null,
            advertisedIds: options.map((entry) => entry.id),
            optionPresent: !!option,
            currentValue: option?.currentValue ?? null,
            requestedValueAdvertised: option
              ? values(option).includes(value as string | boolean)
              : false,
          }),
      );
    if (option.currentValue !== value) {
      const response =
        await connection.agent.request<SetSessionConfigOptionResponse>(
          "session/set_config_option",
          {
            sessionId: ctx.sessionId as string,
            configId: option.id,
            value: value as string | boolean,
          },
          {
            cancellationSignal: AbortSignal.timeout(30_000),
            stopWaitingOnCancel: true,
          },
        );
      options = response.configOptions;
      if (options.find((entry) => entry.id === key)?.currentValue !== value)
        throw new Error(`ACP agent did not apply configuration '${key}'`);
    }
  }
}

function prompt(ctx: AcpContext, text: string): void {
  const connection = requireConnection(ctx);
  if (ctx.turn) throw new Error("ACP prompt turn is already active");
  ctx.text = "";
  const generation = ++ctx.generation;
  // ACP v1 has user content only. These sections separate data; they do not create system priority.
  ctx.turn = connection.agent
    .request("session/prompt", {
      sessionId: ctx.sessionId as string,
      prompt: [
        ...(!ctx.instructionsSent && ctx.instructions
          ? [{ type: "text" as const, text: ctx.instructions }]
          : []),
        { type: "text", text },
      ],
    })
    .then((response) => {
      if (generation !== ctx.generation) return;
      if (response.stopReason === "end_turn") {
        ctx.instructionsSent = true;
        emit(ctx, {
          events: [
            ...(ctx.text
              ? [{ kind: "message" as const, payload: { text: ctx.text } }]
              : []),
            { kind: "done", payload: { stop_reason: response.stopReason } },
          ],
        });
      } else {
        emit(ctx, {
          events: [
            {
              kind: "error",
              payload: {
                message: `ACP turn stopped: ${response.stopReason}`,
                stop_reason: response.stopReason,
              },
            },
          ],
        });
      }
    })
    .catch((error: unknown) => {
      if (generation === ctx.generation)
        emit(ctx, {
          events: [
            {
              kind: "error",
              payload: {
                message: error instanceof Error ? error.message : String(error),
              },
            },
          ],
        });
    })
    .finally(() => {
      ctx.turn = undefined;
    });
}

async function interrupt(ctx: AcpContext, text: string): Promise<void> {
  const connection = requireConnection(ctx);
  const active = ctx.turn;
  if (active) {
    // Only the terminal prompt response confirms cancellation; the notification itself does not.
    ++ctx.generation;
    await connection.agent.notify("session/cancel", {
      sessionId: ctx.sessionId as string,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        active,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  "ACP cancellation did not reach a terminal prompt response",
                ),
              ),
            30_000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  prompt(ctx, text);
}

export function createAcpAdapter(
  provider: "copilot" | "dsh",
): WorkerAdapter<AcpContext> {
  return {
    provider,
    transport: "acp",
    buildArgs(view: SupervisorView): string[] {
      if (provider === "dsh") return ["--profile", "acp"];
      const args = ["--no-auto-update", "--acp", "--stdio"];
      if (view.model) args.push("--model", view.model);
      if (view.reasoningEffort)
        args.push("--reasoning-effort", view.reasoningEffort);
      return args;
    },
    createCtx(): AcpContext {
      return {
        output: new PassThrough(),
        instructions: "",
        instructionsSent: false,
        text: "",
        generation: 0,
        ready: false,
      };
    },
    output(child: WorkerChild, ctx: AcpContext): Readable {
      const app = client()
        .onRequest("session/request_permission", ({ params }) => {
          const option =
            params.options.find((entry) => entry.kind === "allow_once") ??
            params.options.find((entry) => entry.kind === "allow_always");
          if (!option)
            throw new Error("ACP permission request has no allow option");
          return {
            outcome: { outcome: "selected", optionId: option.optionId },
          };
        })
        .onNotification("session/update", ({ params }) => {
          const update = params.update;
          if (params.sessionId !== ctx.sessionId) return;
          if (
            update.sessionUpdate === "agent_message_chunk" &&
            update.content.type === "text"
          ) {
            ctx.text += update.content.text;
            emit(ctx, {
              events: [
                {
                  kind: "progress",
                  payload: {
                    detail: {
                      kind: "message",
                      text_delta: update.content.text,
                    },
                  },
                },
              ],
            });
          } else if (
            update.sessionUpdate === "tool_call" ||
            update.sessionUpdate === "tool_call_update"
          ) {
            emit(ctx, {
              events: [{ kind: "progress", payload: { detail: update } }],
            });
          }
        });
      ctx.connection = app.connect(
        ndJsonStream(
          Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
          Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
        ),
      );
      void ctx.connection.closed.then(() => ctx.output.end());
      return ctx.output;
    },
    async handshake({ ctx, view }): Promise<void> {
      const connection = ctx.connection;
      if (!connection) throw new Error("ACP output transport is not connected");
      const initialized = await connection.agent.request(
        "initialize",
        {
          protocolVersion: PROTOCOL_VERSION,
          clientInfo: { name: "trellis-teamwork", version: "1" },
          clientCapabilities: {},
        },
        {
          cancellationSignal: AbortSignal.timeout(30_000),
          stopWaitingOnCancel: true,
        },
      );
      if (initialized.protocolVersion !== PROTOCOL_VERSION)
        throw new Error(
          `unsupported ACP protocol version ${initialized.protocolVersion}`,
        );
      ctx.agentInfo = initialized.agentInfo ?? undefined;
      const resumeMethod =
        provider === "dsh" ? "session/resume" : "session/load";
      if (
        view.resume &&
        !(provider === "dsh"
          ? initialized.agentCapabilities?.sessionCapabilities?.resume
          : initialized.agentCapabilities?.loadSession)
      )
        throw new Error(`ACP agent does not advertise ${resumeMethod}`);
      const session = view.resume
        ? await connection.agent.request<
            LoadSessionResponse | ResumeSessionResponse
          >(
            resumeMethod,
            { sessionId: view.resume, cwd: view.cwd, mcpServers: [] },
            {
              cancellationSignal: AbortSignal.timeout(30_000),
              stopWaitingOnCancel: true,
            },
          )
        : await connection.agent.request<NewSessionResponse>(
            "session/new",
            { cwd: view.cwd, mcpServers: [] },
            {
              cancellationSignal: AbortSignal.timeout(30_000),
              stopWaitingOnCancel: true,
            },
          );
      ctx.sessionId = view.resume ?? (session as NewSessionResponse).sessionId;
      if (!ctx.sessionId) throw new Error("ACP session did not return an id");
      ctx.instructions = view.systemPrompt;
      ctx.instructionsSent = false;
      const options = session.configOptions ?? [];
      const requested = { ...view.options };
      if (view.model) requested.model = view.model;
      if (view.reasoningEffort)
        requested.reasoning_effort = view.reasoningEffort;
      await configure(ctx, options, requested);
      ctx.ready = true;
      emit(ctx, { events: [], side: { persistSessionId: ctx.sessionId } });
    },
    isReady(ctx): boolean {
      return ctx.ready;
    },
    parseLine(line): ParseResult {
      return JSON.parse(line) as ParseResult;
    },
    async deliverMessage(text, ctx, isInterrupt): Promise<void> {
      if (isInterrupt) {
        await interrupt(ctx, text);
      } else prompt(ctx, text);
    },
    encodeUserMessage(): string {
      throw new Error("ACP uses the SDK message transport");
    },
    encodeInterruptMessage(): string {
      throw new Error("ACP uses the SDK cancel transport");
    },
  };
}
