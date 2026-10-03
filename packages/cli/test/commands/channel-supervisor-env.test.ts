import { describe, expect, it } from "vitest";

import { buildWorkerEnv } from "../../src/commands/channel/supervisor.js";

describe("channel worker environment", () => {
  it("removes Cognee environment from Codex subnodes after merge", () => {
    const env = buildWorkerEnv(
      { provider: "codex", agent: "subnode", env: { COGNEE_API_KEY: "config-key" } },
      { COGNEE_BASE_URL: "https://cognee.example", COGNEE_API_KEY: "parent-key", KEEP: "1" },
      { COGNEE_PROJECT_NAME: "project", TRELLIS_CHANNEL: "channel" },
    );

    expect(env).toEqual({ KEEP: "1", TRELLIS_CHANNEL: "channel" });
  });
});
