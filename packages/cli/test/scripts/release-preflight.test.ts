import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { npmVersionMatches } from "../../scripts/release-preflight.js";

const PREFLIGHT_SCRIPT = path.resolve(
  __dirname,
  "../../scripts/release-preflight.js",
);

describe("release npm visibility verification", () => {
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
});
