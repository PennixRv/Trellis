import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addThreadContext,
  createTeamworkSession,
  deleteThreadContext,
  listForumThreads,
  listThreadContext,
  postThread,
  readTeamworkEvents,
  reduceThreads,
  renameThread,
  showThread,
} from "../../src/teamwork/index.js";
import { setupTeamworkSessionTmp, type TmpEnv } from "./setup.js";

describe("thread reducer and lifecycle", () => {
  let env: TmpEnv;
  beforeEach(() => {
    env = setupTeamworkSessionTmp();
    vi.spyOn(process, "cwd").mockReturnValue(env.projectDir);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    env.cleanup();
  });

  it("rejects post on a chat sessionId", async () => {
    await createTeamworkSession({ sessionId: "chat-only", by: "main" });
    await expect(
      postThread({
        sessionId: "chat-only",
        by: "main",
        action: "opened",
        thread: "x",
      }),
    ).rejects.toThrow(/requires a forum Teamwork Session/);
  });

  it("rejects thread reads and context mutations on chat Teamwork Sessions", async () => {
    await createTeamworkSession({ sessionId: "chat-read", by: "main" });

    await expect(listForumThreads({ sessionId: "chat-read" })).rejects.toThrow(
      /requires a forum Teamwork Session/,
    );
    await expect(
      showThread({ sessionId: "chat-read", thread: "issue" }),
    ).rejects.toThrow(/requires a forum Teamwork Session/);
    await expect(
      addThreadContext({
        sessionId: "chat-read",
        by: "main",
        thread: "issue",
        context: [{ type: "raw", text: "note" }],
      }),
    ).rejects.toThrow(/requires a forum Teamwork Session/);
  });

  it("reduces opened/comment/status/labels/processed/lastSeq", async () => {
    await createTeamworkSession({ sessionId: "b", by: "main", type: "forum" });
    await postThread({
      sessionId: "b",
      by: "main",
      action: "opened",
      thread: "t1",
      title: "Title",
      labels: ["a"],
      assignees: ["arch"],
    });
    await postThread({
      sessionId: "b",
      by: "arch",
      action: "comment",
      thread: "t1",
      text: "Reviewed",
    });
    await postThread({
      sessionId: "b",
      by: "main",
      action: "status",
      thread: "t1",
      status: "closed",
    });
    await postThread({
      sessionId: "b",
      by: "main",
      action: "labels",
      thread: "t1",
      labels: ["a", "b"],
    });
    await postThread({
      sessionId: "b",
      by: "main",
      action: "processed",
      thread: "t1",
    });

    const states = await listForumThreads({ sessionId: "b" });
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      thread: "t1",
      title: "Title",
      status: "processed",
      labels: ["a", "b"],
      assignees: ["arch"],
      comments: 1,
    });
    const events = await readTeamworkEvents({ sessionId: "b" });
    expect(states[0].lastSeq).toBe(events.at(-1)?.seq);
  });

  describe("thread rename alias semantics", () => {
    it("resolves a -> b chain into b including pre-rename and late-old-key events", async () => {
      await createTeamworkSession({ sessionId: "r", by: "main", type: "forum" });
      await postThread({
        sessionId: "r",
        by: "main",
        action: "opened",
        thread: "old",
        title: "Old",
      });
      await postThread({
        sessionId: "r",
        by: "main",
        action: "comment",
        thread: "old",
        text: "before-rename",
      });
      await renameThread({
        sessionId: "r",
        by: "main",
        thread: "old",
        newThread: "new",
      });
      // A late comment written to the OLD key after rename should
      // resolve to the new thread.
      await postThread({
        sessionId: "r",
        by: "main",
        action: "comment",
        thread: "old",
        text: "after-rename-on-old-key",
      });

      const states = await listForumThreads({ sessionId: "r" });
      expect(states).toHaveLength(1);
      expect(states[0].thread).toBe("new");
      expect(states[0].aliases).toContain("old");
      // showThread by either key returns the merged timeline.
      const fromNew = await showThread({ sessionId: "r", thread: "new" });
      const fromOld = await showThread({ sessionId: "r", thread: "old" });
      expect(fromNew.length).toBe(fromOld.length);
      expect(fromOld.length).toBeGreaterThanOrEqual(4); // opened + comment + rename + late comment
    });

    it("rejects rename when target already exists", async () => {
      await createTeamworkSession({ sessionId: "rc", by: "main", type: "forum" });
      await postThread({
        sessionId: "rc",
        by: "main",
        action: "opened",
        thread: "a",
      });
      await postThread({
        sessionId: "rc",
        by: "main",
        action: "opened",
        thread: "b",
      });
      await expect(
        renameThread({
          sessionId: "rc",
          by: "main",
          thread: "a",
          newThread: "b",
        }),
      ).rejects.toThrow(/already exists/);
    });

    it("rejects rename when the source thread does not exist", async () => {
      await createTeamworkSession({
        sessionId: "missing-source",
        by: "main",
        type: "forum",
      });

      await expect(
        renameThread({
          sessionId: "missing-source",
          by: "main",
          thread: "missing",
          newThread: "new",
        }),
      ).rejects.toThrow(/not found/);
    });

    it("flattens chains a -> b -> c into c", async () => {
      await createTeamworkSession({ sessionId: "ch", by: "main", type: "forum" });
      await postThread({
        sessionId: "ch",
        by: "main",
        action: "opened",
        thread: "a",
      });
      await renameThread({
        sessionId: "ch",
        by: "main",
        thread: "a",
        newThread: "b",
      });
      await renameThread({
        sessionId: "ch",
        by: "main",
        thread: "b",
        newThread: "c",
      });
      const states = await listForumThreads({ sessionId: "ch" });
      expect(states[0].thread).toBe("c");
      expect(new Set(states[0].aliases)).toEqual(new Set(["a", "b"]));
    });
  });

  describe("thread context", () => {
    it("add/delete thread context and resolves through rename", async () => {
      await createTeamworkSession({ sessionId: "tc", by: "main", type: "forum" });
      await postThread({
        sessionId: "tc",
        by: "main",
        action: "opened",
        thread: "issue",
      });
      await addThreadContext({
        sessionId: "tc",
        by: "main",
        thread: "issue",
        context: [
          { type: "file", path: "/abs/a.md" },
          { type: "raw", text: "note" },
        ],
      });
      await deleteThreadContext({
        sessionId: "tc",
        by: "main",
        thread: "issue",
        context: [{ type: "raw", text: "note" }],
      });
      let listed = await listThreadContext({
        sessionId: "tc",
        thread: "issue",
      });
      expect(listed).toEqual([{ type: "file", path: "/abs/a.md" }]);

      // Rename and look up by old key.
      await renameThread({
        sessionId: "tc",
        by: "main",
        thread: "issue",
        newThread: "issue-new",
      });
      listed = await listThreadContext({
        sessionId: "tc",
        thread: "issue",
      });
      expect(listed).toEqual([{ type: "file", path: "/abs/a.md" }]);
      const states = await listForumThreads({ sessionId: "tc" });
      expect(states[0].thread).toBe("issue-new");
      expect(states[0].context).toEqual([
        { type: "file", path: "/abs/a.md" },
      ]);
    });
  });

  it("reduceThreads computes from raw events too", async () => {
    const events = [
      {
        seq: 1,
        ts: "2026-05-13T00:00:00.000Z",
        kind: "create",
        by: "main",
        type: "forum",
      },
      {
        seq: 2,
        ts: "2026-05-13T00:00:01.000Z",
        kind: "thread",
        by: "main",
        action: "opened",
        thread: "t",
        title: "T",
      },
      {
        seq: 3,
        ts: "2026-05-13T00:00:02.000Z",
        kind: "thread",
        by: "main",
        action: "comment",
        thread: "t",
        text: "hi",
      },
    ] as const;
    // @ts-expect-error - mixed-literal const widening for TeamworkEvent[]
    const states = reduceThreads([...events]);
    expect(states).toHaveLength(1);
    expect(states[0].comments).toBe(1);
  });
});
