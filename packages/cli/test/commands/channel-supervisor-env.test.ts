import { describe, expect, it } from "vitest";

import { buildWorkerEnv } from "../../src/commands/channel/supervisor.js";

describe("channel worker environment", () => {
  it("removes AgentMemory credentials from Codex subnodes after merge", () => {
    const env = buildWorkerEnv(
      { provider: "codex", agent: "subnode", env: { AGENTMEMORY_SECRET: "config-secret" } },
      { AGENTMEMORY_URL: "https://memory.example", AGENTMEMORY_SECRET: "parent-secret", KEEP: "1" },
      { AGENTMEMORY_PROJECT_NAME: "project", TRELLIS_CHANNEL: "channel" },
    );

    expect(env).toEqual({ KEEP: "1", AGENTMEMORY_SDK_CHILD: "1", TRELLIS_CHANNEL: "channel" });
  });
});
