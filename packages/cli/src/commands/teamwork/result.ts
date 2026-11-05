import { z } from "zod";
import type { TeamworkEvent } from "./store/events.js";

export const teammateContentSchema = z
  .object({
    schema_version: z.literal(2),
    status: z.enum(["complete", "blocked", "incomplete", "error"]),
    answer: z.string().trim().min(1).max(65536),
    evidence: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            locator: z.string().min(1).max(4096),
            summary: z.string().min(1).max(4096),
          })
          .strict(),
      )
      .min(1)
      .max(256),
    limitations: z.array(z.string().min(1).max(4096)).max(128),
    unresolved: z.array(z.string().min(1).max(4096)).max(128),
    deviations: z.array(z.string().min(1).max(4096)).max(128),
  })
  .strict();

export type TeammateContent = z.infer<typeof teammateContentSchema>;

export interface TeamworkResult {
  schemaVersion: 1;
  kind: "trellis_result";
  mode: "interactive" | "batch";
  association: Record<string, string | number>;
  execution: {
    status: "completed" | "error" | "timeout" | "cancelled" | "uncertain";
    provider?: string;
    requestedModel?: string;
    reason?: string;
    stopped: boolean;
  };
  reports: {
    association: Record<string, string | number>;
    report: TeammateContent | null;
    validation: "passed" | "failed" | "legacy" | "not_run";
    error?: string;
    artifact?: { path: string; sha256: string };
    worklogPath?: string;
  }[];
  attempts?: TeamworkResult["reports"];
  semanticValidation: "not_run";
  disposition: string;
  diagnosticsPath?: string;
}

export function parseTeammateContent(text: string): TeammateContent {
  return teammateContentSchema.parse(JSON.parse(text) as unknown);
}

export function failedTeamworkResult(
  mode: TeamworkResult["mode"],
  association: TeamworkResult["association"],
  error: unknown,
  stopped = false,
): TeamworkResult {
  return {
    schemaVersion: 1,
    kind: "trellis_result",
    mode,
    association,
    execution: {
      status: "error",
      stopped,
      reason: error instanceof Error ? error.message : String(error),
    },
    reports: [],
    semanticValidation: "not_run",
    disposition: "unknown",
  };
}

/** Bound a persistent reply to its completed input, never another turn's text. */
export function buildInteractiveResult(
  sessionId: string,
  worker: string,
  terminal: TeamworkEvent,
  events: TeamworkEvent[],
): TeamworkResult {
  const result: TeamworkResult = {
    schemaVersion: 1,
    kind: "trellis_result",
    mode: "interactive",
    association: { sessionId, worker },
    execution: { status: "error", stopped: false },
    reports: [],
    semanticValidation: "not_run",
    disposition: "not_applicable",
  };
  if (
    terminal.kind !== "turn_finished" ||
    terminal.outcome !== "done" ||
    typeof terminal.inputSeq !== "number" ||
    typeof terminal.turnId !== "string"
  ) {
    result.execution.reason =
      terminal.kind === "error"
        ? terminal.message
        : terminal.kind === "killed"
          ? terminal.reason
          : "Turn did not finish successfully";
    if (terminal.kind === "killed") result.execution.status = "cancelled";
    return result;
  }
  result.execution.status = "completed";
  const { inputSeq, turnId } = terminal;
  result.association.inputSeq = inputSeq;
  result.association.turnId = turnId;
  const item: TeamworkResult["reports"][number] = {
    association: { worker, inputSeq, turnId },
    report: null,
    validation: "failed",
  };
  result.reports.push(item);
  const message = events
    .filter(
      (event) =>
        event.kind === "message" &&
        event.by === worker &&
        event.seq > inputSeq &&
        event.seq < terminal.seq,
    )
    .pop();
  try {
    if (message?.kind !== "message")
      throw new Error("Completed turn has no matching reply");
    item.report = parseTeammateContent(message.text ?? "");
    item.validation = "passed";
  } catch (error) {
    item.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}
