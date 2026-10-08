import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import type { AppendablePartial, ChannelEvent } from "./events.js";
import { withLock } from "./lock.js";
import { channelRoot } from "./paths.js";

interface SessionRelation {
  parentSessionId: string;
  sessionId: string;
  provider: "codex";
  firstBoundAt: string;
}

interface RelationStore {
  schemaVersion: 1;
  trackingSince: string;
  relations: SessionRelation[];
}

export interface SessionDescendants {
  schemaVersion: 1;
  ownerSessionId: string;
  sessionIds: string[];
  sessionCount: number;
  trackingSince: string | null;
  coverage: "since_activation" | "not_started";
}

function relationPath(): string {
  return path.join(channelRoot(), ".session-relations.json");
}

function validIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  );
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateStore(value: unknown): RelationStore {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid session relation store");
  }
  const store = value as Partial<RelationStore>;
  if (
    store.schemaVersion !== 1 ||
    !validTimestamp(store.trackingSince) ||
    !Array.isArray(store.relations)
  ) {
    throw new Error("Invalid session relation store schema");
  }
  const parents = new Map<string, string>();
  for (const relation of store.relations) {
    if (
      !relation ||
      !validIdentity(relation.parentSessionId) ||
      !validIdentity(relation.sessionId) ||
      relation.provider !== "codex" ||
      !validTimestamp(relation.firstBoundAt) ||
      parents.has(relation.sessionId)
    ) {
      throw new Error("Invalid or duplicate session relation");
    }
    parents.set(relation.sessionId, relation.parentSessionId);
  }
  for (const id of parents.keys()) {
    const visited = new Set<string>();
    let current: string | undefined = id;
    while (current !== undefined) {
      if (visited.has(current)) throw new Error("Cyclic session relation");
      visited.add(current);
      current = parents.get(current);
    }
  }
  return store as RelationStore;
}

async function readStore(): Promise<RelationStore | null> {
  let text: string;
  try {
    text = await fsp.readFile(relationPath(), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return validateStore(JSON.parse(text) as unknown);
}

/** Internal binding writer: exact Channel metadata only, never inferred history. */
export async function recordSessionBinding(
  events: ChannelEvent[],
  binding: AppendablePartial,
): Promise<void> {
  const owner = events.find((event) => event.kind === "create")?.ownerSessionId;
  if (owner === undefined) return;
  const spawned = [...events]
    .reverse()
    .find((event) => event.kind === "spawned" && event.as === binding.worker);
  if (spawned?.provider !== "codex") return;
  if (!validIdentity(owner) || !validIdentity(binding.sessionId)) {
    throw new Error("Invalid owned Codex session binding");
  }
  const parentSessionId = owner;
  const sessionId = binding.sessionId;
  const root = channelRoot();
  await fsp.mkdir(root, { recursive: true, mode: 0o700 });
  // ponytail: one short metadata lock; shard only if binding volume warrants it.
  await withLock(path.join(root, ".session-relations.lock"), async () => {
    const now = new Date().toISOString();
    const store = (await readStore()) ?? {
      schemaVersion: 1,
      trackingSince: now,
      relations: [],
    };
    const previous = store.relations.find(
      (relation) => relation.sessionId === sessionId,
    );
    if (previous) {
      if (previous.parentSessionId !== parentSessionId) {
        throw new Error("Conflicting session parent ownership");
      }
      return;
    }
    store.relations.push({
      parentSessionId,
      sessionId,
      provider: "codex",
      firstBoundAt: now,
    });
    validateStore(store);
    const temporary = `${relationPath()}.tmp.${process.pid}.${randomUUID()}`;
    try {
      await fsp.writeFile(temporary, JSON.stringify(store) + "\n", {
        mode: 0o600,
        flag: "wx",
      });
      await fsp.rename(temporary, relationPath());
    } finally {
      await fsp.rm(temporary, { force: true });
    }
  });
}

/** Read all exact Codex descendants across projects, independently of live Channels. */
export async function listSessionDescendants(input: {
  ownerSessionId: string;
}): Promise<SessionDescendants> {
  if (!validIdentity(input.ownerSessionId))
    throw new Error("A valid owner session is required");
  const store = await readStore();
  const children = new Map<string, string[]>();
  for (const relation of store?.relations ?? []) {
    const list = children.get(relation.parentSessionId) ?? [];
    list.push(relation.sessionId);
    children.set(relation.parentSessionId, list);
  }
  const descendants = new Set<string>();
  const pending = [input.ownerSessionId];
  for (const parent of pending) {
    for (const child of children.get(parent) ?? []) {
      if (descendants.has(child)) continue;
      descendants.add(child);
      pending.push(child);
    }
  }
  const sessionIds = [...descendants].sort();
  return {
    schemaVersion: 1,
    ownerSessionId: input.ownerSessionId,
    sessionIds,
    sessionCount: sessionIds.length,
    trackingSince: store?.trackingSince ?? null,
    coverage: store ? "since_activation" : "not_started",
  };
}
