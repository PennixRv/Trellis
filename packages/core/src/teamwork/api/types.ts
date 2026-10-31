import type { DeliveryMode } from "../internal/store/delivery.js";
import type {
  TeamworkSessionScope,
  ContextEntry,
  EventOrigin,
} from "../internal/store/schema.js";

export interface TeamworkSessionAddressOptions {
  sessionId: string;
  scope?: TeamworkSessionScope;
  /** Storage project bucket key. Not the create-event `project` slug. */
  projectKey?: string;
  /** cwd used to derive the project bucket when scope is "project". */
  cwd?: string;
}

export interface MutationCommonOptions {
  by: string;
  origin?: EventOrigin;
  meta?: Record<string, unknown>;
}

export interface CreateTeamworkSessionOptions
  extends TeamworkSessionAddressOptions,
    MutationCommonOptions {
  type?: "chat" | "forum";
  task?: string;
  project?: string;
  labels?: string[];
  description?: string;
  context?: ContextEntry[];
  ephemeral?: boolean;
  force?: boolean;
  /** Reserved free-form field allowing CLI to mark "run" mode etc. via meta. */
}

export interface SendMessageOptions
  extends TeamworkSessionAddressOptions,
    MutationCommonOptions {
  idempotencyKey?: string;
  text: string;
  to?: string | string[];
  /**
   * Delivery validation mode. Defaults to `appendOnly`, which preserves
   * append-only / pre-spawn backlog behavior. Strict modes append the
   * message first, then append `undeliverable` events for targeted
   * workers that fail the selected condition.
   */
  deliveryMode?: DeliveryMode;
}

export interface PostThreadOptions
  extends TeamworkSessionAddressOptions,
    MutationCommonOptions {
  idempotencyKey?: string;
  action:
    | "opened"
    | "comment"
    | "status"
    | "labels"
    | "assignees"
    | "summary"
    | "processed";
  thread: string;
  title?: string;
  text?: string;
  description?: string;
  status?: string;
  labels?: string[];
  assignees?: string[];
  summary?: string;
  context?: ContextEntry[];
}

export interface ContextMutationOptions
  extends TeamworkSessionAddressOptions,
    MutationCommonOptions {
  context: ContextEntry[];
}

export interface ThreadContextMutationOptions extends ContextMutationOptions {
  thread: string;
}

export interface RenameThreadOptions
  extends TeamworkSessionAddressOptions,
    MutationCommonOptions {
  thread: string;
  newThread: string;
}

export interface SetTeamworkSessionTitleOptions
  extends TeamworkSessionAddressOptions,
    MutationCommonOptions {
  title: string;
}

export type ClearTeamworkSessionTitleOptions = TeamworkSessionAddressOptions &
  MutationCommonOptions;
