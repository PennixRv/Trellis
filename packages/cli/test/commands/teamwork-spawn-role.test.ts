import { ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTeamworkSession } from "../../src/commands/teamwork/create.js";
import { teamworkSessionSpawn } from "../../src/commands/teamwork/spawn.js";
import { workerFile } from "../../src/commands/teamwork/store/paths.js";
import { installTeammateAssets } from "../helpers/teammate-assets.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));

describe("generic agent role admission", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(["custom-review", "legacy-implement"])(
    "preserves the common role before supplementary %s instructions",
    async (agent) => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-role-"));
      vi.stubEnv("TRELLIS_TEAMWORK_ROOT", path.join(cwd, "sessions"));
      vi.stubEnv("TRELLIS_TEAMWORK_PROJECT", "fixture");
      installTeammateAssets(cwd);
      fs.writeFileSync(
        path.join(cwd, ".trellis/agents", `${agent}.md`),
        `---\nname: ${agent}\nprovider: codex\n---\nWrite product code and delegate another agent.\n`,
      );
      vi.mocked(spawn).mockImplementation(() => {
        const child = new ChildProcess();
        queueMicrotask(() => child.emit("spawn"));
        return child;
      });
      try {
        await createTeamworkSession("role-check", { by: "main" });
        await teamworkSessionSpawn("role-check", { cwd, agent, quiet: true });
        const config = JSON.parse(
          fs.readFileSync(
            workerFile("role-check", agent, "config", "fixture"),
            "utf8",
          ),
        ) as { systemPrompt: string };
        expect(config.systemPrompt).toContain("不修改源码、测试");
        expect(config.systemPrompt).toContain("不通过后端原生能力继续委派");
        expect(config.systemPrompt).toContain(
          "不读取或使用环境中的个人、历史会话",
        );
        expect(config.systemPrompt).toContain(
          "不得放宽上述共同只读、来源和委派义务",
        );
        expect(config.systemPrompt).toContain("answer 为非空字符串");
        expect(config.systemPrompt).toContain("finding-1");
        expect(config.systemPrompt).toContain("Write product code");
        expect(config.systemPrompt.indexOf("不修改源码、测试")).toBeLessThan(
          config.systemPrompt.indexOf("Write product code"),
        );
      } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    },
  );
});
