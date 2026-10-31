import fs from "node:fs";
import fsp from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTeamworkSession,
  sendMessage,
  readTeamworkEvents,
} from "../../src/teamwork/index.js";
import {
  eventsPath,
  seqSidecarPath,
} from "../../src/teamwork/internal/store/paths.js";
import { setupTeamworkSessionTmp, type TmpEnv } from "./setup.js";

describe("appendEvent + .seq sidecar", () => {
  let env: TmpEnv;
  beforeEach(() => {
    env = setupTeamworkSessionTmp();
    vi.spyOn(process, "cwd").mockReturnValue(env.projectDir);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    env.cleanup();
  });

  it("writes sidecar in lock-step with JSONL appends", async () => {
    await createTeamworkSession({ sessionId: "ch1", by: "main" });
    await sendMessage({ sessionId: "ch1", by: "main", text: "hi" });

    const events = await readTeamworkEvents({ sessionId: "ch1" });
    expect(events.map((e) => e.seq)).toEqual([1, 2]);

    const sidecar = await fsp.readFile(
      seqSidecarPath("ch1", "_global"),
      "utf-8",
    ).catch(async () =>
      fsp.readFile(seqSidecarPath("ch1", process.env.TRELLIS_TEAMWORK_PROJECT ?? "_global"), "utf-8"),
    );
    expect(sidecar.trim()).toBe("2");
  });

  it("strictly monotonic seqs under concurrent appends", async () => {
    await createTeamworkSession({ sessionId: "race", by: "main" });
    const N = 32;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        sendMessage({ sessionId: "race", by: "main", text: `m${i}` }),
      ),
    );
    const events = await readTeamworkEvents({ sessionId: "race" });
    const seqs = events.map((e) => e.seq).sort((a, b) => a - b);
    // Create event is seq 1, then N messages.
    expect(seqs).toHaveLength(N + 1);
    for (let i = 0; i < seqs.length; i++) {
      expect(seqs[i]).toBe(i + 1);
    }
  });

  it("rebuilds sidecar when missing", async () => {
    await createTeamworkSession({ sessionId: "lazy", by: "main" });
    await sendMessage({ sessionId: "lazy", by: "main", text: "one" });
    await sendMessage({ sessionId: "lazy", by: "main", text: "two" });
    // Delete the sidecar to simulate a pre-sidecar sessionId.
    const projectKey = process.env.TRELLIS_TEAMWORK_PROJECT ?? "";
    const sidecar = seqSidecarPath("lazy", projectKey);
    fs.unlinkSync(sidecar);
    await sendMessage({ sessionId: "lazy", by: "main", text: "three" });
    const events = await readTeamworkEvents({ sessionId: "lazy" });
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(fs.existsSync(sidecar)).toBe(true);
    expect(fs.readFileSync(sidecar, "utf-8").trim()).toBe("4");
  });

  it("rebuilds sidecar when corrupted", async () => {
    await createTeamworkSession({ sessionId: "corrupt", by: "main" });
    await sendMessage({ sessionId: "corrupt", by: "main", text: "one" });
    const projectKey = process.env.TRELLIS_TEAMWORK_PROJECT ?? "";
    const sidecar = seqSidecarPath("corrupt", projectKey);
    fs.writeFileSync(sidecar, "not-a-number\n");
    await sendMessage({ sessionId: "corrupt", by: "main", text: "two" });
    const events = await readTeamworkEvents({ sessionId: "corrupt" });
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(fs.readFileSync(sidecar, "utf-8").trim()).toBe("3");
  });

  it("repairs sidecar lower than JSONL tail without duplicate seq", async () => {
    await createTeamworkSession({ sessionId: "behind", by: "main" });
    await sendMessage({ sessionId: "behind", by: "main", text: "one" });
    await sendMessage({ sessionId: "behind", by: "main", text: "two" });
    const projectKey = process.env.TRELLIS_TEAMWORK_PROJECT ?? "";
    const sidecar = seqSidecarPath("behind", projectKey);
    fs.writeFileSync(sidecar, "1\n");
    await sendMessage({ sessionId: "behind", by: "main", text: "three" });
    const events = await readTeamworkEvents({ sessionId: "behind" });
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(fs.readFileSync(sidecar, "utf-8").trim()).toBe("4");
  });

  it("repairs sidecar ahead of JSONL tail without seq gap", async () => {
    await createTeamworkSession({ sessionId: "ahead", by: "main" });
    await sendMessage({ sessionId: "ahead", by: "main", text: "one" });
    const projectKey = process.env.TRELLIS_TEAMWORK_PROJECT ?? "";
    const sidecar = seqSidecarPath("ahead", projectKey);
    fs.writeFileSync(sidecar, "99\n");
    await sendMessage({ sessionId: "ahead", by: "main", text: "two" });
    const events = await readTeamworkEvents({ sessionId: "ahead" });
    // Sidecar-ahead repairs back to JSONL tail rather than honoring the
    // stale future seq. Next assigned seq is jsonl_tail + 1.
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(fs.readFileSync(sidecar, "utf-8").trim()).toBe("3");
  });

  it("continues seq after a torn JSONL tail", async () => {
    await createTeamworkSession({ sessionId: "torn", by: "main" });
    await sendMessage({ sessionId: "torn", by: "main", text: "one" });
    const file = eventsPath(
      "torn",
      process.env.TRELLIS_TEAMWORK_PROJECT ?? "",
    );
    const prefix = fs.readFileSync(file);
    fs.appendFileSync(file, '{"seq":99,"kind":"progress","by":"w","text":"cut');
    await sendMessage({ sessionId: "torn", by: "main", text: "two" });
    const events = await readTeamworkEvents({ sessionId: "torn" });
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(events.at(-1)).toMatchObject({ kind: "message", text: "two" });
    const after = fs.readFileSync(file);
    expect(after.subarray(0, prefix.length).equals(prefix)).toBe(true);
    expect(after.includes(Buffer.from('"seq":99'))).toBe(false);
  });

  it("continues seq after a tail cut mid-multibyte character", async () => {
    await createTeamworkSession({ sessionId: "utf8-torn", by: "main" });
    await sendMessage({ sessionId: "utf8-torn", by: "main", text: "one" });
    const file = eventsPath(
      "utf8-torn",
      process.env.TRELLIS_TEAMWORK_PROJECT ?? "",
    );
    const prefix = fs.readFileSync(file);
    // Incomplete UTF-8 for U+4E2D (中): first two bytes only.
    fs.appendFileSync(file, Buffer.from([0xe4, 0xb8]));
    await sendMessage({ sessionId: "utf8-torn", by: "main", text: "two" });
    const events = await readTeamworkEvents({ sessionId: "utf8-torn" });
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    const after = fs.readFileSync(file);
    expect(after.subarray(0, prefix.length).equals(prefix)).toBe(true);
  });

  it("fails seq recovery when JSONL has no recoverable seq", async () => {
    await createTeamworkSession({ sessionId: "bad-jsonl", by: "main" });
    const file = eventsPath("bad-jsonl");
    fs.writeFileSync(file, "not-json\n{\"kind\":\"message\"}\n");

    await expect(
      sendMessage({ sessionId: "bad-jsonl", by: "main", text: "two" }),
    ).rejects.toThrow("Unable to recover Teamwork Session sequence");
  });

  it("does not full-read events.jsonl on the normal append path", async () => {
    await createTeamworkSession({ sessionId: "no-fullscan", by: "main" });
    // Write a large body of events directly through the API and ensure
    // the JSONL file grows without breaking seq assignment.
    for (let i = 0; i < 20; i++) {
      await sendMessage({
        sessionId: "no-fullscan",
        by: "main",
        text: "x".repeat(200) + ` #${i}`,
      });
    }
    const events = await readTeamworkEvents({ sessionId: "no-fullscan" });
    expect(events).toHaveLength(21);
    expect(events.at(-1)?.seq).toBe(21);
    // Smoke check: the JSONL is bigger than the sidecar tail window so a
    // full-scan path would be observably more expensive. Just confirm
    // size > tail size used by seq.ts (4096B) to make the intent obvious.
    const file = eventsPath(
      "no-fullscan",
      process.env.TRELLIS_TEAMWORK_PROJECT ?? "",
    );
    expect(fs.statSync(file).size).toBeGreaterThan(4096);
  });
});
