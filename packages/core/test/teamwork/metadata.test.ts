import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addTeamworkSessionContext,
  clearTeamworkSessionTitle,
  createTeamworkSession,
  deleteTeamworkSessionContext,
  listTeamworkSessionContext,
  parseTeamworkSessionType,
  readTeamworkEvents,
  readTeamworkSessionMetadata,
  sendMessage,
  setTeamworkSessionTitle,
} from "../../src/teamwork/index.js";
import { setupTeamworkSessionTmp, type TmpEnv } from "./setup.js";

describe("reduceTeamworkSessionMetadata", () => {
  let env: TmpEnv;
  beforeEach(() => {
    env = setupTeamworkSessionTmp();
    vi.spyOn(process, "cwd").mockReturnValue(env.projectDir);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    env.cleanup();
  });

  it("projects type/description/labels/context from create event", async () => {
    await createTeamworkSession({
      sessionId: "meta",
      by: "main",
      type: "forum",
      description: "Test feed",
      labels: ["x", "y"],
      context: [
        { type: "file", path: "/abs/a.md" },
        { type: "raw", text: "note" },
      ],
    });
    const md = await readTeamworkSessionMetadata({ sessionId: "meta" });
    expect(md).toMatchObject({
      type: "forum",
      description: "Test feed",
      labels: ["x", "y"],
    });
    expect(md.context).toHaveLength(2);
    expect(md.title).toBeUndefined();
  });

  it("rejects session types outside chat and forum", () => {
    expect(() => parseTeamworkSessionType("thread")).toThrow(/chat, forum/);
    expect(() => parseTeamworkSessionType("threads")).toThrow(/chat, forum/);
  });

  it("rejects legacy type values at the core create boundary", async () => {
    await expect(
      createTeamworkSession({
        sessionId: "legacy-thread",
        by: "main",
        type: "thread" as "forum",
      }),
    ).rejects.toThrow(/chat, forum/);
    await expect(
      createTeamworkSession({
        sessionId: "legacy-threads",
        by: "main",
        type: "threads" as "forum",
      }),
    ).rejects.toThrow(/chat, forum/);
  });

  it("projects sessionId-level context add/delete", async () => {
    await createTeamworkSession({ sessionId: "ctx", by: "main", type: "forum" });
    await addTeamworkSessionContext({
      sessionId: "ctx",
      by: "main",
      context: [{ type: "raw", text: "first" }],
    });
    await addTeamworkSessionContext({
      sessionId: "ctx",
      by: "main",
      context: [{ type: "file", path: "/abs/two.md" }],
    });
    let listed = await listTeamworkSessionContext({ sessionId: "ctx" });
    expect(listed).toHaveLength(2);

    await deleteTeamworkSessionContext({
      sessionId: "ctx",
      by: "main",
      context: [{ type: "raw", text: "first" }],
    });
    listed = await listTeamworkSessionContext({ sessionId: "ctx" });
    expect(listed).toEqual([{ type: "file", path: "/abs/two.md" }]);

    // raw event log retains the full history
    const events = await readTeamworkEvents({ sessionId: "ctx" });
    expect(events.filter((e) => e.kind === "context")).toHaveLength(3);
  });

  it("projects sessionId title set/clear", async () => {
    await createTeamworkSession({ sessionId: "named", by: "main", type: "forum" });
    await setTeamworkSessionTitle({
      sessionId: "named",
      by: "main",
      title: "Readable Title",
    });
    let md = await readTeamworkSessionMetadata({ sessionId: "named" });
    expect(md.title).toBe("Readable Title");

    await clearTeamworkSessionTitle({ sessionId: "named", by: "main" });
    md = await readTeamworkSessionMetadata({ sessionId: "named" });
    expect(md.title).toBeUndefined();
  });

  it("validates origin and meta at the event boundary", async () => {
    await createTeamworkSession({ sessionId: "base-validation", by: "main" });
    await expect(
      sendMessage({
        sessionId: "base-validation",
        by: "main",
        text: "invalid origin",
        origin: "bad-origin" as "cli",
      }),
    ).rejects.toThrow(/Invalid origin/);
    await expect(
      sendMessage({
        sessionId: "base-validation",
        by: "main",
        text: "invalid meta",
        meta: [] as unknown as Record<string, unknown>,
      }),
    ).rejects.toThrow(/meta must be a plain JSON object/);
    await expect(
      sendMessage({
        sessionId: "base-validation",
        by: "main",
        text: "invalid meta null",
        meta: null as unknown as Record<string, unknown>,
      }),
    ).rejects.toThrow(/meta must be a plain JSON object/);
    await expect(
      sendMessage({
        sessionId: "base-validation",
        by: "main",
        text: "invalid meta primitive",
        meta: "x" as unknown as Record<string, unknown>,
      }),
    ).rejects.toThrow(/meta must be a plain JSON object/);
  });
});
