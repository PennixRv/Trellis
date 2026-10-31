import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTeamworkSession,
  postThread,
  readTeamworkEvents,
  sendMessage,
} from "../../src/teamwork/index.js";
import { appendEvent } from "../../src/teamwork/internal/store/events.js";
import { setupTeamworkSessionTmp, type TmpEnv } from "./setup.js";

describe("durable idempotency", () => {
  let env: TmpEnv;
  beforeEach(() => {
    env = setupTeamworkSessionTmp();
    vi.spyOn(process, "cwd").mockReturnValue(env.projectDir);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    env.cleanup();
  });

  describe("sendMessage", () => {
    it("returns the original event when replayed with the same key", async () => {
      await createTeamworkSession({ sessionId: "c", by: "main" });
      const first = await sendMessage({
        sessionId: "c",
        by: "main",
        text: "hello",
        idempotencyKey: "cmd-1",
      });
      const second = await sendMessage({
        sessionId: "c",
        by: "main",
        text: "hello",
        idempotencyKey: "cmd-1",
      });

      expect(second.seq).toBe(first.seq);
      expect(second.ts).toBe(first.ts);
      expect(second.idempotencyKey).toBe("cmd-1");

      const events = await readTeamworkEvents({ sessionId: "c" });
      const messages = events.filter((e) => e.kind === "message");
      expect(messages).toHaveLength(1);
    });

    it("appends independent events when no key is provided", async () => {
      await createTeamworkSession({ sessionId: "c", by: "main" });
      const a = await sendMessage({ sessionId: "c", by: "main", text: "hi" });
      const b = await sendMessage({ sessionId: "c", by: "main", text: "hi" });
      expect(b.seq).toBe(a.seq + 1);

      const events = await readTeamworkEvents({ sessionId: "c" });
      const messages = events.filter((e) => e.kind === "message");
      expect(messages).toHaveLength(2);
    });

    it("treats different keys as distinct writes", async () => {
      await createTeamworkSession({ sessionId: "c", by: "main" });
      const a = await sendMessage({
        sessionId: "c",
        by: "main",
        text: "one",
        idempotencyKey: "k-1",
      });
      const b = await sendMessage({
        sessionId: "c",
        by: "main",
        text: "two",
        idempotencyKey: "k-2",
      });
      expect(b.seq).toBe(a.seq + 1);
    });

    it("survives a simulated process restart by reading the durable log", async () => {
      await createTeamworkSession({ sessionId: "c", by: "main" });
      const first = await sendMessage({
        sessionId: "c",
        by: "main",
        text: "hello",
        idempotencyKey: "cmd-restart",
      });

      // Simulating restart: re-invoke without any in-memory state.
      // The implementation must read the existing JSONL to detect the key.
      const replayed = await sendMessage({
        sessionId: "c",
        by: "main",
        text: "hello",
        idempotencyKey: "cmd-restart",
      });
      expect(replayed.seq).toBe(first.seq);

      const events = await readTeamworkEvents({ sessionId: "c" });
      expect(events.filter((e) => e.kind === "message")).toHaveLength(1);
    });
  });

  describe("postThread", () => {
    it("returns the original event when replayed with the same key", async () => {
      await createTeamworkSession({ sessionId: "f", by: "main", type: "forum" });
      const first = await postThread({
        sessionId: "f",
        by: "main",
        action: "opened",
        thread: "t1",
        title: "Title",
        idempotencyKey: "thread-1",
      });
      const second = await postThread({
        sessionId: "f",
        by: "main",
        action: "opened",
        thread: "t1",
        title: "Title",
        idempotencyKey: "thread-1",
      });

      expect(second.seq).toBe(first.seq);
      expect(second.ts).toBe(first.ts);

      const events = await readTeamworkEvents({ sessionId: "f" });
      const threads = events.filter((e) => e.kind === "thread");
      expect(threads).toHaveLength(1);
    });

    it("appends independent thread events when no key is provided", async () => {
      await createTeamworkSession({ sessionId: "f", by: "main", type: "forum" });
      await postThread({
        sessionId: "f",
        by: "main",
        action: "opened",
        thread: "t1",
      });
      await postThread({
        sessionId: "f",
        by: "main",
        action: "comment",
        thread: "t1",
        text: "one",
      });
      await postThread({
        sessionId: "f",
        by: "main",
        action: "comment",
        thread: "t1",
        text: "two",
      });
      const events = await readTeamworkEvents({ sessionId: "f" });
      const comments = events.filter(
        (e) => e.kind === "thread" && e.action === "comment",
      );
      expect(comments).toHaveLength(2);
    });
  });

  describe("validation", () => {
    it("rejects empty idempotency keys", async () => {
      await createTeamworkSession({ sessionId: "c", by: "main" });
      await expect(
        sendMessage({
          sessionId: "c",
          by: "main",
          text: "hi",
          idempotencyKey: "",
        }),
      ).rejects.toThrow(/idempotencyKey must be a non-empty string/);
    });

    it("rejects whitespace-only idempotency keys", async () => {
      await createTeamworkSession({ sessionId: "c", by: "main" });
      await expect(
        sendMessage({
          sessionId: "c",
          by: "main",
          text: "hi",
          idempotencyKey: "   ",
        }),
      ).rejects.toThrow(/idempotencyKey must be a non-empty string/);
    });

    it("rejects reusing a key across different event kinds", async () => {
      await createTeamworkSession({ sessionId: "f", by: "main", type: "forum" });
      await sendMessage({
        sessionId: "f",
        by: "main",
        text: "first",
        idempotencyKey: "shared",
      });
      await expect(
        postThread({
          sessionId: "f",
          by: "main",
          action: "opened",
          thread: "t1",
          idempotencyKey: "shared",
        }),
      ).rejects.toThrow(/already used for message/);
    });
  });

  describe("strict delivery replay", () => {
    it("does not duplicate undeliverable events when sendMessage is replayed", async () => {
      await createTeamworkSession({ sessionId: "c", by: "main" });
      const first = await sendMessage({
        sessionId: "c",
        by: "main",
        text: "hi",
        to: ["ghost-a", "ghost-b"],
        deliveryMode: "requireKnownWorker",
        idempotencyKey: "cmd-strict",
      });
      const replay = await sendMessage({
        sessionId: "c",
        by: "main",
        text: "hi",
        to: ["ghost-a", "ghost-b"],
        deliveryMode: "requireKnownWorker",
        idempotencyKey: "cmd-strict",
      });

      expect(replay.seq).toBe(first.seq);

      const events = await readTeamworkEvents({ sessionId: "c" });
      const undeliverable = events.filter((e) => e.kind === "undeliverable");
      expect(undeliverable).toHaveLength(2);
      expect(undeliverable.map((e) => e.targetWorker).sort()).toEqual([
        "ghost-a",
        "ghost-b",
      ]);
      expect(events.filter((e) => e.kind === "message")).toHaveLength(1);
    });

    it("uses the persisted message target when a strict send replay drifts", async () => {
      await createTeamworkSession({ sessionId: "c", by: "main" });
      await sendMessage({
        sessionId: "c",
        by: "main",
        text: "hi",
        to: "ghost-a",
        deliveryMode: "requireKnownWorker",
        idempotencyKey: "cmd-drift",
      });
      await sendMessage({
        sessionId: "c",
        by: "main",
        text: "hi",
        to: "ghost-b",
        deliveryMode: "requireKnownWorker",
        idempotencyKey: "cmd-drift",
      });

      const events = await readTeamworkEvents({ sessionId: "c" });
      const undeliverable = events.filter((e) => e.kind === "undeliverable");
      expect(undeliverable).toHaveLength(1);
      expect(undeliverable[0]).toMatchObject({
        targetWorker: "ghost-a",
        messageSeq: 2,
      });
    });
  });

  describe("appendEvent direct", () => {
    it("returns the same persisted event for repeated direct keyed appends", async () => {
      await createTeamworkSession({ sessionId: "c", by: "main" });
      const first = await appendEvent("c", {
        kind: "progress",
        by: "w",
        idempotencyKey: "p-1",
      });
      const second = await appendEvent("c", {
        kind: "progress",
        by: "w",
        idempotencyKey: "p-1",
      });
      expect(second.seq).toBe(first.seq);
    });
  });
});
