import { describe, expect, it } from "vitest";

import {
  assertSafeName,
  sessionDir,
} from "../../src/commands/teamwork/store/paths.js";

// The CLI keeps its own copy of the Teamwork Session path helpers, so the
// path-traversal guard needs its own regression test here — a change to
// the CLI copy alone must not silently drop the check.
describe("CLI Teamwork Session name path-traversal guard", () => {
  it("rejects traversal and separators", () => {
    for (const bad of ["..", ".", "../x", "../../x", "a/b", "a\\b"]) {
      expect(() => assertSafeName(bad)).toThrow(/Invalid Teamwork Session name/);
    }
  });

  it("accepts the names real teamworkSessions use", () => {
    for (const ok of ["a", "chat-only", "ch1", "legacy_thread", "a.b"]) {
      expect(() => assertSafeName(ok)).not.toThrow();
    }
  });

  it("sessionDir refuses to resolve outside the store", () => {
    expect(() => sessionDir("../../escape")).toThrow(
      /Invalid Teamwork Session name/,
    );
  });
});
