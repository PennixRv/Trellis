import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appendEvent,
  createChannel,
  listSessionDescendants,
} from "../../src/channel/index.js";
import {
  channelDir,
  channelRoot,
} from "../../src/channel/internal/store/paths.js";
import { setupChannelTmp, type TmpEnv } from "./setup.js";

describe("durable owned Codex session membership", () => {
  let env: TmpEnv;
  beforeEach(() => {
    env = setupChannelTmp();
    vi.spyOn(process, "cwd").mockReturnValue(env.projectDir);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    env.cleanup();
  });

  async function bind(
    channel: string,
    owner: string,
    sessionId: string,
  ): Promise<void> {
    await createChannel({ channel, by: "main", ownerSessionId: owner });
    await appendEvent(channel, {
      kind: "spawned",
      by: "main",
      as: "worker",
      provider: "codex",
    });
    await appendEvent(channel, {
      kind: "session_bound",
      by: "worker",
      worker: "worker",
      sessionId,
    });
  }

  it("queries descendants after cleanup, keeps owners isolated, and does not freeze reused sessions", async () => {
    expect(
      await listSessionDescendants({ ownerSessionId: "root" }),
    ).toMatchObject({
      sessionIds: [],
      trackingSince: null,
      coverage: "not_started",
    });
    await bind("first", "root", "child-a");
    await appendEvent("first", {
      kind: "session_bound",
      by: "worker",
      worker: "worker",
      sessionId: "child-a",
    });
    await appendEvent("first", {
      kind: "session_bound",
      by: "worker",
      worker: "worker",
      sessionId: "retry-b",
    });
    await bind("nested", "child-a", "grandchild");
    await bind("other", "other-root", "unrelated");
    fs.rmSync(channelDir("first"), { recursive: true });
    await createChannel({
      channel: "nested",
      by: "main",
      force: true,
      ownerSessionId: "root",
    });
    const result = await listSessionDescendants({ ownerSessionId: "root" });
    expect(result.sessionIds).toEqual(["child-a", "grandchild", "retry-b"]);
    expect(result.sessionCount).toBe(3);
    expect(result.coverage).toBe("since_activation");
    expect(
      fs.statSync(path.join(channelRoot(), ".session-relations.json")).mode &
        0o777,
    ).toBe(0o600);
    expect(
      (await listSessionDescendants({ ownerSessionId: "other-root" }))
        .sessionIds,
    ).toEqual(["unrelated"]);
  });

  it("serializes independent writers and rejects parent conflicts/cycles without losing the old snapshot", async () => {
    await Promise.all([bind("a", "root", "a"), bind("b", "root", "b")]);
    await bind("conflict", "other-root", "other");
    await expect(
      appendEvent("conflict", {
        kind: "session_bound",
        by: "worker",
        worker: "worker",
        sessionId: "a",
      }),
    ).rejects.toThrow("Conflicting session parent");
    await bind("cycle", "a", "leaf");
    await expect(
      appendEvent("cycle", {
        kind: "session_bound",
        by: "worker",
        worker: "worker",
        sessionId: "root",
      }),
    ).rejects.toThrow("Cyclic");
    expect(
      (await listSessionDescendants({ ownerSessionId: "root" })).sessionIds,
    ).toEqual(["a", "b", "leaf"]);
    expect(
      fs
        .readdirSync(channelRoot())
        .filter((name) => name.includes(".tmp.") || name.endsWith(".lock")),
    ).toEqual([]);
  });

  it("fails on corrupted data and atomic-write failure instead of acknowledging the binding", async () => {
    await bind("c", "root", "first");
    const file = path.join(channelRoot(), ".session-relations.json");
    const previous = fs.readFileSync(file, "utf-8");
    fs.writeFileSync(file, "broken");
    await expect(
      listSessionDescendants({ ownerSessionId: "root" }),
    ).rejects.toThrow();
    await expect(
      appendEvent("c", {
        kind: "session_bound",
        by: "worker",
        worker: "worker",
        sessionId: "next",
      }),
    ).rejects.toThrow();
    fs.writeFileSync(file, previous);
    vi.spyOn(fsp, "rename").mockRejectedValueOnce(
      new Error("atomic rename failed"),
    );
    await expect(
      appendEvent("c", {
        kind: "session_bound",
        by: "worker",
        worker: "worker",
        sessionId: "next",
      }),
    ).rejects.toThrow();
    expect(fs.readFileSync(file, "utf-8")).toBe(previous);
    expect(
      fs.readdirSync(channelRoot()).filter((name) => name.includes(".tmp.")),
    ).toEqual([]);
    expect(
      (await listSessionDescendants({ ownerSessionId: "root" })).sessionIds,
    ).toEqual(["first"]);
  });
});
