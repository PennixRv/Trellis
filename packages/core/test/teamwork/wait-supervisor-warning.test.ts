import { describe, expect, it } from "vitest";

import {
  matchesEventFilter,
  parseTeamworkEventKind,
  parseTeamworkEventKinds,
  type TeamworkEvent,
} from "../../src/teamwork/index.js";

function makeEvent<K extends TeamworkEvent["kind"]>(
  kind: K,
  overrides: Partial<TeamworkEvent> = {},
): TeamworkEvent {
  return {
    seq: 1,
    ts: "2026-05-15T00:00:00.000Z",
    kind,
    by: "worker",
    ...overrides,
  } as TeamworkEvent;
}

describe("parseTeamworkEventKind / parseTeamworkEventKinds", () => {
  it("parseTeamworkEventKind rejects CSV input (single-value only)", () => {
    expect(() => parseTeamworkEventKind("done,killed")).toThrow(/Invalid --kind/);
  });

  it("parseTeamworkEventKind accepts the new supervisor_warning kind", () => {
    expect(parseTeamworkEventKind("supervisor_warning")).toBe("supervisor_warning");
  });

  it("parseTeamworkEventKinds returns undefined for undefined input", () => {
    expect(parseTeamworkEventKinds(undefined)).toBeUndefined();
  });

  it("parseTeamworkEventKinds returns undefined for whitespace-only / empty input", () => {
    expect(parseTeamworkEventKinds("")).toBeUndefined();
    expect(parseTeamworkEventKinds("   ,  , ")).toBeUndefined();
  });

  it("parseTeamworkEventKinds splits CSV and validates each member", () => {
    expect(parseTeamworkEventKinds("done,killed")).toEqual(["done", "killed"]);
  });

  it("parseTeamworkEventKinds deduplicates while preserving order", () => {
    expect(parseTeamworkEventKinds("done, killed ,done")).toEqual(["done", "killed"]);
  });

  it("parseTeamworkEventKinds reuses the single-value error path on an invalid member", () => {
    expect(() => parseTeamworkEventKinds("done,nope")).toThrow(/Invalid --kind 'nope'/);
  });
});

describe("matchesEventFilter with kind union", () => {
  it("supervisor_warning is not meaningful by default — plain wait does not wake", () => {
    const ev = makeEvent("supervisor_warning", { worker: "w" });
    expect(matchesEventFilter(ev, {})).toBe(false);
  });

  it("supervisor_warning matches when explicitly requested via single kind", () => {
    const ev = makeEvent("supervisor_warning", { worker: "w" });
    expect(matchesEventFilter(ev, { kind: "supervisor_warning" })).toBe(true);
  });

  it("supervisor_warning matches when explicitly listed in a kind array", () => {
    const ev = makeEvent("supervisor_warning", { worker: "w" });
    expect(
      matchesEventFilter(ev, { kind: ["done", "supervisor_warning"] }),
    ).toBe(true);
  });

  it("supervisor_warning is also matched by includeNonMeaningful with no kind filter", () => {
    const ev = makeEvent("supervisor_warning", { worker: "w" });
    expect(matchesEventFilter(ev, { includeNonMeaningful: true })).toBe(true);
  });

  it("OR semantics: done matches kind list [done, killed]", () => {
    const ev = makeEvent("done");
    expect(matchesEventFilter(ev, { kind: ["done", "killed"] })).toBe(true);
  });

  it("OR semantics: killed matches kind list [done, killed]", () => {
    const ev = makeEvent("killed");
    expect(matchesEventFilter(ev, { kind: ["done", "killed"] })).toBe(true);
  });

  it("OR semantics: error does not match kind list [done, killed]", () => {
    const ev = makeEvent("error", { message: "oops" });
    expect(matchesEventFilter(ev, { kind: ["done", "killed"] })).toBe(false);
  });

  it("empty kind list does not falsely match (and re-applies meaningful gate)", () => {
    const warn = makeEvent("supervisor_warning", { worker: "w" });
    expect(matchesEventFilter(warn, { kind: [] })).toBe(false);
    const done = makeEvent("done");
    // empty kind list = no kind constraint; meaningful gate still admits done
    expect(matchesEventFilter(done, { kind: [] })).toBe(true);
  });

  it("single-value kind continues to work unchanged", () => {
    expect(matchesEventFilter(makeEvent("done"), { kind: "done" })).toBe(true);
    expect(matchesEventFilter(makeEvent("killed"), { kind: "done" })).toBe(
      false,
    );
  });
});
