import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PREFLIGHT_SCRIPT = path.resolve(
  __dirname,
  "../../scripts/release-preflight.js",
);

describe("release npm visibility verification", () => {
  it("waits through the bounded public-registry propagation window", () => {
    const source = fs.readFileSync(PREFLIGHT_SCRIPT, "utf-8");

    expect(source).toContain("const attempts = 18;");
    expect(source).toContain("10_000");
  });
});
