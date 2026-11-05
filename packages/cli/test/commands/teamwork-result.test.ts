import { describe, expect, it } from "vitest";
import {
  buildInteractiveResult,
  parseTeammateContent,
} from "../../src/commands/teamwork/result.js";
import type { TeamworkEvent } from "../../src/commands/teamwork/store/events.js";

const report = {
  schema_version: 2,
  status: "complete",
  answer: "7 + 9 = 16",
  evidence: [
    { id: "input", locator: "task-input", summary: "alpha=7; gamma=9" },
  ],
  limitations: [],
  unresolved: [],
  deviations: [],
};
const event = (fields: Record<string, unknown>): TeamworkEvent =>
  ({ sessionId: "s", ts: "2026-11-05T00:00:00Z", ...fields }) as TeamworkEvent;

describe("normalized teammate results", () => {
  it.each(["complete", "blocked", "incomplete", "error"])(
    "preserves content status %s without claiming semantic acceptance",
    (status) => {
      expect(
        parseTeammateContent(JSON.stringify({ ...report, status })).status,
      ).toBe(status);
    },
  );

  it.each([
    { answer: " " },
    { evidence: [] },
    { status: "accepted" },
    { extra: "unknown" },
  ])("rejects invalid content %j", (change) => {
    expect(() =>
      parseTeammateContent(JSON.stringify({ ...report, ...change })),
    ).toThrow();
  });

  it("correlates only the final reply within the completed input turn", () => {
    const end = event({
      kind: "turn_finished",
      by: "w",
      worker: "w",
      seq: 8,
      inputSeq: 5,
      turnId: "t2",
      outcome: "done",
    });
    const events = [
      event({
        kind: "message",
        by: "w",
        seq: 2,
        text: JSON.stringify({ ...report, answer: "old" }),
      }),
      event({ kind: "message", by: "other", seq: 6, text: "unrelated" }),
      event({ kind: "message", by: "w", seq: 7, text: JSON.stringify(report) }),
      end,
      event({ kind: "message", by: "w", seq: 10, text: "next turn" }),
    ];
    const result = buildInteractiveResult("s", "w", end, events);
    expect(result.association).toMatchObject({ inputSeq: 5, turnId: "t2" });
    expect(result.reports[0]).toMatchObject({ validation: "passed", report });
    expect(result.semanticValidation).toBe("not_run");
    expect(
      buildInteractiveResult(
        "s",
        "w",
        end,
        events.filter((event) => event.seq <= 2),
      ).reports[0]?.validation,
    ).toBe("failed");
  });

  it("does not turn a legacy done or supervisor failure into a valid report", () => {
    for (const terminal of [
      event({ kind: "done", seq: 4, by: "w" }),
      event({
        kind: "error",
        seq: 4,
        by: "supervisor:w",
        message: "configuration failed",
      }),
    ]) {
      const result = buildInteractiveResult("s", "w", terminal, []);
      expect(result.execution.status).toBe("error");
      expect(result.reports).toEqual([]);
    }
  });
});
