import { describe, expect, it } from "vitest";
import { redactDiagnostic } from "../../src/channel/index.js";

describe("diagnostic credential boundary", () => {
  it("redacts known text and nested credential fields without changing protocol input", () => {
    const input = { text: "Bearer SYNTHETIC_CANARY password=SYNTHETIC_CANARY", detail: { api_key: "SYNTHETIC_CANARY" }, seq: 3 };
    const output = redactDiagnostic(input);
    expect(JSON.stringify(output)).not.toContain("SYNTHETIC_CANARY");
    expect(output.seq).toBe(3);
    expect(input.detail.api_key).toBe("SYNTHETIC_CANARY");
    expect(redactDiagnostic("ordinary text with arbitrary value")).toBe("ordinary text with arbitrary value");
  });
});
