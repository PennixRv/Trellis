import { describe, expect, it } from "vitest";

import { buildWorkerEnv } from "../../src/commands/channel/supervisor.js";

describe("channel worker environment", () => {
  it("preserves inherited settings with role then runtime precedence", () => {
    const env = buildWorkerEnv(
      { provider: "codex", agent: "subnode", env: { ROLE: "config", SHARED: "role" } },
      { PARENT: "parent", SHARED: "parent", KEEP: "1" },
      { SHARED: "runtime", TRELLIS_CHANNEL: "channel" },
    );

    expect(env).toEqual({ PARENT: "parent", ROLE: "config", SHARED: "runtime", KEEP: "1", TRELLIS_CHANNEL: "channel" });
  });
});
