import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, it } from "vitest";

it("enforces real independent-worktree binding, bounded reports and unknown-outcome recovery", () => {
  const result = execFileSync(
    "python3",
    [
      path.join(__dirname, "fixtures/worktree_delegation_test.py"),
      path.resolve(__dirname, "../../src/templates/trellis/scripts"),
    ],
    { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] },
  );
  expect(result).toBe("");
});
