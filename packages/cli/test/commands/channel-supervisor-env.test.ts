import { describe, expect, it } from "vitest";

import { buildWorkerEnv } from "../../src/commands/channel/supervisor.js";

describe("channel worker environment", () => {
  it("limits inherited settings while preserving provider, role, and runtime precedence", () => {
    const env = buildWorkerEnv(
      { provider: "codex", agent: "subnode", roleEnvKeys: ["ROLE_KEY"], env: { ROLE: "config", SHARED: "role" } },
      { HOME: "/home/test", PATH: "/bin", OPENAI_API_KEY: "provider-secret", PARENT_SECRET: "unrelated", ROLE_KEY: "role-secret", SHARED: "parent", KEEP: "1" },
      { SHARED: "runtime", TRELLIS_CHANNEL: "channel" },
    );

    expect(env).toEqual({ HOME: "/home/test", PATH: "/bin", OPENAI_API_KEY: "provider-secret", ROLE_KEY: "role-secret", ROLE: "config", SHARED: "runtime", TRELLIS_CHANNEL: "channel" });
  });
});
