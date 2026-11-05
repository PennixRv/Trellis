import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  npmVersionMatches,
  npmVersionValue,
  retry,
} from "../../scripts/release-preflight.js";

const PREFLIGHT_SCRIPT = path.resolve(
  __dirname,
  "../../scripts/release-preflight.js",
);

describe("release npm visibility verification", () => {
  it("retries asynchronous registry visibility errors and stops after success", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const probe = vi
        .fn()
        .mockRejectedValueOnce(new Error("E404"))
        .mockRejectedValueOnce(
          new Error("tag still points to previous version"),
        )
        .mockResolvedValue("visible");
      const pending = retry("registry", probe);
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBe("visible");
      expect(probe).toHaveBeenCalledTimes(3);
      const failedProbe = vi.fn().mockRejectedValue(new Error("not visible"));
      const failed = expect(retry("registry", failedProbe)).rejects.toThrow(
        "not visible",
      );
      await vi.runAllTimersAsync();
      await failed;
      expect(failedProbe).toHaveBeenCalledTimes(18);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
  it("accepts npm's exact-version JSON string and single-item array forms", () => {
    expect(
      npmVersionMatches('"0.7.0-beta.4.pennix.1"', "0.7.0-beta.4.pennix.1"),
    ).toBe(true);
    expect(
      npmVersionMatches('["0.7.0-beta.4.pennix.1"]', "0.7.0-beta.4.pennix.1"),
    ).toBe(true);
    expect(
      npmVersionMatches(
        '["0.7.0-beta.4.pennix.1", "other"]',
        "0.7.0-beta.4.pennix.1",
      ),
    ).toBe(false);
    expect(npmVersionMatches("not-json", "0.7.0-beta.4.pennix.1")).toBe(false);
  });

  it("waits through the bounded public-registry propagation window", () => {
    const source = fs.readFileSync(PREFLIGHT_SCRIPT, "utf-8");

    expect(source).toContain("const attempts = 18;");
    expect(source).toContain("10_000");
  });

  it("normalizes npm's single-item version arrays", () => {
    expect(npmVersionValue(["0.7.0-beta.6"])).toBe("0.7.0-beta.6");
    expect(npmVersionValue("0.7.0-beta.6")).toBe("0.7.0-beta.6");
    expect(npmVersionValue([])).toEqual([]);
  });
});
