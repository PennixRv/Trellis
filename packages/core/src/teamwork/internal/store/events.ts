import fs from "node:fs";
import fsp from "node:fs/promises";

import { withLock } from "./lock.js";
import {
  sessionDir,
  eventsPath,
  lockPath,
  seqSidecarPath,
} from "./paths.js";
import { reconcileSeq, truncateIncompleteTail, writeSidecar } from "./seq.js";
import type {
  TeamworkSessionType,
  ContextEntry,
  ContextMutationAction,
  ContextTarget,
  EventOrigin,
  InboxPolicy,
  ThreadAction,
} from "./schema.js";
import { parseEventOrigin } from "./schema.js";

export type TeamworkEventKind =
  | "create"
  | "join"
  | "leave"
  | "message"
  | "thread"
  | "context"
  | "teamwork"
  | "spawned"
  | "killed"
  | "respawned"
  | "progress"
  | "done"
  | "error"
  | "waiting"
  | "awake"
  | "undeliverable"
  | "interrupt_requested"
  | "turn_started"
  | "turn_finished"
  | "interrupted"
  | "supervisor_warning"
  | "coordination";

export const TEAMWORK_EVENT_KINDS: ReadonlySet<TeamworkEventKind> = new Set([
  "create",
  "join",
  "leave",
  "message",
  "thread",
  "context",
  "teamwork",
  "spawned",
  "killed",
  "respawned",
  "progress",
  "done",
  "error",
  "waiting",
  "awake",
  "undeliverable",
  "interrupt_requested",
  "turn_started",
  "turn_finished",
  "interrupted",
  "supervisor_warning",
  "coordination",
]);

export function parseTeamworkEventKind(
  v: string | undefined,
): TeamworkEventKind | undefined {
  if (v === undefined) return undefined;
  if (!TEAMWORK_EVENT_KINDS.has(v as TeamworkEventKind)) {
    throw new Error(
      `Invalid --kind '${v}'. Must be one of: ${[...TEAMWORK_EVENT_KINDS].join(", ")}`,
    );
  }
  return v as TeamworkEventKind;
}

/**
 * Parse a CSV of event kinds into a typed list. Each member is validated
 * through {@link parseTeamworkEventKind} so the single-value error message and
 * whitelist remain the SOT. Returns `undefined` when input is undefined
 * or contains no non-empty members.
 */
export function parseTeamworkEventKinds(
  v: string | undefined,
): TeamworkEventKind[] | undefined {
  if (v === undefined) return undefined;
  const parts = v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return undefined;
  const out: TeamworkEventKind[] = [];
  const seen = new Set<TeamworkEventKind>();
  for (const part of parts) {
    const parsed = parseTeamworkEventKind(part);
    if (parsed === undefined) continue;
    if (seen.has(parsed)) continue;
    seen.add(parsed);
    out.push(parsed);
  }
  return out;
}

export interface BaseTeamworkEvent<
  K extends TeamworkEventKind = TeamworkEventKind,
> {
  seq: number;
  ts: string;
  kind: K;
  by: string;
  idempotencyKey?: string;
  to?: string | string[];
  origin?: EventOrigin;
  meta?: Record<string, unknown>;
  [extra: string]: unknown;
}

export interface CreateTeamworkEvent extends BaseTeamworkEvent<"create"> {
  cwd?: string;
  task?: string;
  type?: TeamworkSessionType;
  description?: string;
  context?: ContextEntry[];
  labels?: string[];
  ephemeral?: boolean;
}

export interface MessageTeamworkEvent extends BaseTeamworkEvent<"message"> {
  text?: string;
}

export interface ThreadTeamworkEvent extends BaseTeamworkEvent<"thread"> {
  action?: ThreadAction;
  thread: string;
  title?: string;
  text?: string;
  description?: string;
  status?: string;
  labels?: string[];
  assignees?: string[];
  summary?: string;
  context?: ContextEntry[];
  /** Rename target (action === "rename"). */
  newThread?: string;
}

export interface ContextTeamworkEvent extends BaseTeamworkEvent<"context"> {
  target: ContextTarget;
  action: ContextMutationAction;
  context: ContextEntry[];
  thread?: string;
}

export interface TeamworkMetadataEvent extends BaseTeamworkEvent<"teamwork"> {
  action: "title";
  title?: string | null;
}

export interface SpawnedTeamworkEvent extends BaseTeamworkEvent<"spawned"> {
  as?: string;
  provider?: string;
  pid?: number;
  agent?: string;
  files?: string[];
  manifests?: string[];
  /**
   * Inbox delivery policy selected at spawn. Durable worker state — the
   * worker registry projects `spawned` events without this field as
   * `explicitOnly`.
   */
  inboxPolicy?: InboxPolicy;
}

export interface KilledTeamworkEvent extends BaseTeamworkEvent<"killed"> {
  /**
   * Why the worker was killed. Well-known supervisor / CLI reasons:
   * `"explicit-kill"` (CLI `teamwork kill` or signal),
   * `"timeout"` (explicit `--timeout`), `"crash"` (post-spawn worker
   * error — projected to the `crashed` lifecycle), and
   * `"idle-timeout"` (OOM-guard idle TTL). Additional string values may
   * appear from custom runtimes; consumers should treat unknown reasons
   * as opaque.
   */
  reason?: string;
  signal?: string;
  /** Worker the kill targeted (when written by the CLI kill path). */
  worker?: string;
  timeout_ms?: number;
  /** Idle TTL in ms that the worker exceeded, when `reason="idle-timeout"`. */
  idle_timeout_ms?: number;
}

export interface DoneTeamworkEvent extends BaseTeamworkEvent<"done"> {
  duration_ms?: number;
  exit_code?: number;
  synthesized?: boolean;
}

export interface ErrorTeamworkEvent extends BaseTeamworkEvent<"error"> {
  message?: string;
  provider?: string;
  synthesized?: boolean;
  exit_code?: number;
  exit_signal?: string;
}

export interface ProgressTeamworkEvent extends BaseTeamworkEvent<"progress"> {
  detail?: Record<string, unknown>;
}

/** Why a worker interrupt was requested. */
export type InterruptReason = "user" | "system" | "timeout" | "superseded";

/** How an interrupt was attempted by the worker runtime. */
export type InterruptMethod = "provider" | "stdin" | "signal" | "none";

/** Result of an interrupt attempt as reported by the worker runtime. */
export type InterruptOutcome =
  | "interrupted"
  | "queued"
  | "unsupported"
  | "no-active-turn"
  | "failed";

/** Why a message could not be delivered to a targeted worker. */
export type UndeliverableReason = "worker-terminal" | "worker-unknown";

export interface UndeliverableTeamworkEvent
  extends BaseTeamworkEvent<"undeliverable"> {
  targetWorker: string;
  messageSeq: number;
  reason: UndeliverableReason;
}

export interface InterruptRequestedTeamworkEvent
  extends BaseTeamworkEvent<"interrupt_requested"> {
  worker: string;
  turnId?: string;
  reason?: InterruptReason;
  message?: string;
}

export interface TurnStartedTeamworkEvent
  extends BaseTeamworkEvent<"turn_started"> {
  worker: string;
  /**
   * Durable link to the Teamwork Session `message` event seq that initiated this
   * turn. The worker registry uses this as the "consumed" marker for
   * pending-message projection.
   */
  inputSeq: number;
  turnId?: string;
}

export interface TurnFinishedTeamworkEvent
  extends BaseTeamworkEvent<"turn_finished"> {
  worker: string;
  inputSeq?: number;
  turnId?: string;
  outcome?: "done" | "error" | "aborted";
}

export interface InterruptedTeamworkEvent
  extends BaseTeamworkEvent<"interrupted"> {
  worker: string;
  turnId?: string;
  reason?: InterruptReason;
  method: InterruptMethod;
  outcome: InterruptOutcome;
  message?: string;
}

/** Reason for a supervisor pre-terminal warning event. */
export type SupervisorWarningReason = "approaching_timeout";

/**
 * Pre-timeout observability event. Emitted at most once per worker run.
 * Not part of {@link MEANINGFUL_EVENT_KINDS} so plain `wait` does not
 * wake on it; explicit `--kind supervisor_warning` does match.
 */
export interface SupervisorWarningTeamworkEvent
  extends BaseTeamworkEvent<"supervisor_warning"> {
  worker: string;
  reason: SupervisorWarningReason;
  timeout_ms: number;
  remaining_ms: number;
}

export type CoordinationEntity = "batch" | "assignment" | "attempt" | "teammate";

export type CoordinationBatchState =
  | "PREPARED"
  | "VALIDATING_PLAN"
  | "RUNNING"
  | "SETTLING"
  | "ALL_ACCEPTED"
  | "SETTLED_WITH_FAILURE"
  | "SUSPENDED"
  | "CANCEL_PENDING"
  | "RECONCILIATION_REQUIRED";

export type CoordinationAssignmentState =
  | "QUEUED"
  | "ASSIGNED"
  | "EXECUTING"
  | "REPORT_PENDING"
  | "VALIDATING"
  | "ACCEPTED"
  | "FINAL_FAILED"
  | "WAITING_FOR_MAIN_COMMAND";

export type CoordinationAttemptState =
  | "ASSIGNED"
  | "RUNNING"
  | "REPORT_SUBMITTED"
  | "FAILED"
  | "TIMEOUT_YIELDED"
  | "WAITING_FOR_MAIN_COMMAND"
  | "FINAL_FAILED";

export type CoordinationTeammateState =
  | "ASSIGNED"
  | "RUNNING"
  | "REPORT_SUBMITTED"
  | "FAILED"
  | "TIMEOUT_YIELDED"
  | "WAITING_FOR_MAIN_COMMAND";

export type CoordinationState =
  | CoordinationBatchState
  | CoordinationAssignmentState
  | CoordinationAttemptState
  | CoordinationTeammateState;

export type CoordinationAction =
  | "state_transition"
  | "terminal_observed"
  | "claim_created"
  | "command_issued"
  | "receipt_recorded"
  | "lease_acquired"
  | "lease_released"
  | "reconciliation_required";

export interface CoordinationTeamworkEvent
  extends BaseTeamworkEvent<"coordination"> {
  action: CoordinationAction;
  entity: CoordinationEntity;
  batchId: string;
  assignmentId?: string;
  attemptId?: string;
  teammateId?: string;
  slot?: number;
  retryCount?: number;
  state?: CoordinationState;
  planHash?: string;
  commandId?: string;
  claimId?: string;
  receiptId?: string;
  leaseId?: string;
  protected?: boolean;
  /** Provider session associated with this attempt, when the host exposes one. */
  providerSessionId?: string;
  /** True only when the external process has reported a terminal fact. */
  terminal?: boolean;
  reason?: string;
  outcome?: string;
  payload?: Record<string, unknown>;
}

export type GenericTeamworkEvent = BaseTeamworkEvent<
  Exclude<
    TeamworkEventKind,
    | "create"
    | "message"
    | "thread"
    | "context"
    | "teamwork"
    | "spawned"
    | "killed"
    | "done"
    | "error"
    | "progress"
    | "undeliverable"
    | "interrupt_requested"
    | "turn_started"
    | "turn_finished"
    | "interrupted"
    | "supervisor_warning"
    | "coordination"
  >
>;

export type TeamworkEvent =
  | CreateTeamworkEvent
  | MessageTeamworkEvent
  | ThreadTeamworkEvent
  | ContextTeamworkEvent
  | TeamworkMetadataEvent
  | SpawnedTeamworkEvent
  | KilledTeamworkEvent
  | DoneTeamworkEvent
  | ErrorTeamworkEvent
  | ProgressTeamworkEvent
  | UndeliverableTeamworkEvent
  | InterruptRequestedTeamworkEvent
  | TurnStartedTeamworkEvent
  | TurnFinishedTeamworkEvent
  | InterruptedTeamworkEvent
  | SupervisorWarningTeamworkEvent
  | CoordinationTeamworkEvent
  | GenericTeamworkEvent;

export function isCoordinationEvent(
  ev: TeamworkEvent,
): ev is CoordinationTeamworkEvent {
  return ev.kind === "coordination" && typeof ev.batchId === "string";
}

export function isCreateEvent(ev: TeamworkEvent): ev is CreateTeamworkEvent {
  return ev.kind === "create";
}

export function isThreadEvent(ev: TeamworkEvent): ev is ThreadTeamworkEvent {
  return ev.kind === "thread" && typeof ev.thread === "string";
}

export function isContextEvent(ev: TeamworkEvent): ev is ContextTeamworkEvent {
  return ev.kind === "context";
}

export function isTeamworkMetadataEvent(
  ev: TeamworkEvent,
): ev is TeamworkMetadataEvent {
  return ev.kind === "teamwork";
}

export async function ensureSessionDir(
  name: string,
  project?: string,
): Promise<string> {
  const dir = sessionDir(name, project);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * Read the last committed seq for a Teamwork Session. Uses the same reconcile
 * path as `appendEvent` so callers that need a snapshot do not see a
 * stale sidecar.
 */
export async function readLastSeq(
  name: string,
  project?: string,
): Promise<number> {
  const file = eventsPath(name, project);
  if (!fs.existsSync(file)) return 0;
  return reconcileSeq(file, seqSidecarPath(name, project));
}

export interface AppendablePartial {
  kind: TeamworkEventKind;
  by: string;
  ts?: string;
  idempotencyKey?: string;
  [extra: string]: unknown;
}

/**
 * Append a Teamwork Session event atomically under its lock.
 *
 * Internally truncates a torn JSONL tail (missing final newline), then
 * reconciles the `.seq` sidecar with the JSONL tail. Sidecar repair
 * happens automatically on corruption, missing file, or sidecar drift
 * in either direction. A torn tail must never reset `seq` to 1 or glue
 * the next record onto the incomplete line.
 *
 * @internal Trellis CLI-internal write primitive — downstream consumers
 *   must go through the typed mutation APIs (`createTeamworkSession`,
 *   `sendMessage`, etc.).
 */
export async function appendEvent(
  name: string,
  partial: AppendablePartial,
  project?: string,
): Promise<TeamworkEvent> {
  validateEventBase(partial);
  await ensureSessionDir(name, project);
  const jsonl = eventsPath(name, project);
  const sidecar = seqSidecarPath(name, project);
  return withLock(lockPath(name, project), async () => {
    await truncateIncompleteTail(jsonl);
    const existing = findIdempotentEvent(jsonl, partial);
    if (existing !== undefined) return existing;

    const lastSeq = await reconcileSeq(jsonl, sidecar);
    const event = {
      ...partial,
      seq: lastSeq + 1,
      ts: partial.ts ?? new Date().toISOString(),
    } as TeamworkEvent;
    await fsp.appendFile(jsonl, JSON.stringify(event) + "\n", "utf-8");
    await writeSidecar(sidecar, event.seq);
    return event;
  });
}

function findIdempotentEvent(
  file: string,
  partial: AppendablePartial,
): TeamworkEvent | undefined {
  const key = partial.idempotencyKey;
  if (key === undefined) return undefined;

  for (const ev of readAllEvents(file)) {
    if (ev.idempotencyKey !== key) continue;
    if (ev.kind !== partial.kind) {
      throw new Error(
        `Idempotency key '${key}' was already used for ${ev.kind}; cannot reuse it for ${partial.kind}`,
      );
    }
    return ev;
  }
  return undefined;
}

function validateEventBase(partial: AppendablePartial): void {
  const key = partial.idempotencyKey;
  if (key?.trim().length === 0) {
    throw new Error("idempotencyKey must be a non-empty string");
  }
  const origin = partial.origin;
  if (origin !== undefined) {
    parseEventOrigin(typeof origin === "string" ? origin : String(origin));
  }
  const meta = partial.meta;
  if (
    meta !== undefined &&
    (meta === null || typeof meta !== "object" || Array.isArray(meta))
  ) {
    throw new Error("meta must be a plain JSON object");
  }
}

/**
 * Cursor pagination options for {@link readTeamworkEvents}. When no field
 * is set the reader returns every event (compatibility default).
 */
export interface ReadTeamworkEventsPagination {
  /** Return events with `seq > afterSeq`, ascending. */
  afterSeq?: number;
  /** Return events with `seq < beforeSeq`, ascending. */
  beforeSeq?: number;
  /**
   * Cap the page size. With a cursor, caps the page. Without a cursor,
   * returns the latest N events in ascending seq order.
   */
  limit?: number;
}

/** Default page size applied when a cursor is present but `limit` is not. */
export const DEFAULT_CURSOR_PAGE_SIZE = 200;

function readAllEvents(file: string): TeamworkEvent[] {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf-8");
  const events: TeamworkEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as TeamworkEvent);
    } catch {
      continue;
    }
  }
  return events;
}

export async function readTeamworkEvents(
  name: string,
  project?: string,
  pagination?: ReadTeamworkEventsPagination,
): Promise<TeamworkEvent[]> {
  const file = eventsPath(name, project);
  const all = readAllEvents(file);

  if (
    !pagination ||
    (pagination.afterSeq === undefined &&
      pagination.beforeSeq === undefined &&
      pagination.limit === undefined)
  ) {
    return all;
  }

  const { afterSeq, beforeSeq, limit } = pagination;
  if (afterSeq !== undefined && beforeSeq !== undefined) {
    throw new Error(
      "readTeamworkEvents: pass only one of afterSeq / beforeSeq",
    );
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new Error("readTeamworkEvents: limit must be a non-negative integer");
  }

  // Events are appended in monotonic seq order; keep that as the contract.
  if (afterSeq !== undefined) {
    const page = all.filter((ev) => ev.seq > afterSeq);
    const cap = limit ?? DEFAULT_CURSOR_PAGE_SIZE;
    return page.slice(0, cap);
  }

  if (beforeSeq !== undefined) {
    const page = all.filter((ev) => ev.seq < beforeSeq);
    const cap = limit ?? DEFAULT_CURSOR_PAGE_SIZE;
    // Newest page first internally; return ascending for stable consumers.
    return page.slice(Math.max(0, page.length - cap));
  }

  // limit only: latest N events in ascending seq order.
  return limit !== undefined
    ? all.slice(Math.max(0, all.length - limit))
    : all;
}
