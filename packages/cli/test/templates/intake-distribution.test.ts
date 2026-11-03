import { describe, expect, it } from "vitest";
import {
  collectPlatformTemplates,
  PLATFORM_IDS,
} from "../../src/configurators/index.js";

describe("request intake distribution", () => {
  it.each(PLATFORM_IDS)(
    "%s installs intake and all five phase Skills without an active legacy brainstorm entry",
    (id) => {
      const templates = collectPlatformTemplates(id);
      expect(templates).toBeDefined();
      const entries = [...(templates ?? new Map<string, string>())];
      expect(
        entries.some(([relative]) => relative.includes("/trellis-brainstorm/")),
      ).toBe(false);
      const intake = entries.find(([relative]) =>
        relative.endsWith("/trellis-request-intake/SKILL.md"),
      );
      expect(intake?.[1]).toContain("earliest affected phase");
      expect(intake?.[1]).toContain("do not repeat session initialization");
      for (const phase of [
        "goal-exploration-and-requirements",
        "decision-space-construction-and-merging",
        "solution-design-and-convergence",
        "task-implementation",
        "delivery-review-and-closeout",
      ]) {
        expect(
          entries.some(([relative]) =>
            relative.endsWith(`/trellis-${phase}/SKILL.md`),
          ),
          phase,
        ).toBe(true);
      }
    },
  );
});
