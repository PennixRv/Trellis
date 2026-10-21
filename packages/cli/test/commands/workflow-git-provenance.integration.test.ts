import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runWorkflowCommand } from "../../src/commands/workflow.js";
import { loadWorkflowProvenance } from "../../src/utils/workflow-provenance.js";

describe("Git workflow provenance round trip", () => {
  let originalCwd: string;
  let tmpDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-workflow-git-"));
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(path.join(projectDir, ".trellis"), { recursive: true });
    process.chdir(projectDir);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Git workflow verification must not use HTTP");
      }),
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it.each([
    {
      source: "git@github.com:example/workflows.git",
      gitUrl: "git@github.com:example/workflows.git",
      subdir: "",
    },
    {
      source: "ssh://git@registry.example:2222/team/workflows/templates",
      gitUrl: "ssh://git@registry.example:2222/team/workflows.git",
      subdir: "templates",
    },
    {
      source: "https://registry.example/team/workflows/templates",
      gitUrl: "https://registry.example/team/workflows.git",
      subdir: "templates",
    },
  ])(
    "materializes and verifies $source using the same Git source",
    async (entry) => {
      const registryDir = path.join(tmpDir, "registry");
      const registryRoot = path.join(registryDir, entry.subdir);
      fs.mkdirSync(path.join(registryRoot, "workflows/tdd"), {
        recursive: true,
      });
      const content = "# Git-backed TDD workflow\n";
      fs.writeFileSync(
        path.join(registryRoot, "workflows/tdd/workflow.md"),
        content,
      );
      fs.writeFileSync(
        path.join(registryRoot, "index.json"),
        JSON.stringify({
          version: 1,
          templates: [
            {
              id: "tdd",
              type: "workflow",
              name: "TDD",
              path: "workflows/tdd/workflow.md",
              sha256: createHash("sha256").update(content).digest("hex"),
            },
          ],
        }),
      );
      execFileSync("git", ["init", "--quiet", registryDir]);
      execFileSync("git", ["-C", registryDir, "add", "."]);
      execFileSync("git", [
        "-C",
        registryDir,
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ]);
      const ref = execFileSync(
        "git",
        ["-C", registryDir, "rev-parse", "HEAD"],
        {
          encoding: "utf-8",
        },
      ).trim();
      const configIndex = Number(process.env.GIT_CONFIG_COUNT ?? 0);
      vi.stubEnv("GIT_CONFIG_COUNT", String(configIndex + 1));
      vi.stubEnv(
        `GIT_CONFIG_KEY_${configIndex}`,
        `url.${pathToFileURL(registryDir).href}/.insteadOf`,
      );
      vi.stubEnv(`GIT_CONFIG_VALUE_${configIndex}`, entry.gitUrl);
      const source = `${entry.source}#${ref}`;

      await runWorkflowCommand({ template: "tdd", marketplace: source });
      expect(loadWorkflowProvenance(process.cwd())).toMatchObject({
        registry: source,
        ref,
      });
      await runWorkflowCommand({ verify: true });
      expect(fs.readFileSync(".trellis/workflow.md", "utf-8")).toBe(content);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects embedded HTTPS credentials before fetching or persisting them", async () => {
    await expect(
      runWorkflowCommand({
        template: "tdd",
        marketplace:
          "https://user:password@registry.example/team/workflows#0123456789012345678901234567890123456789",
      }),
    ).rejects.toThrow("cannot include URL credentials");
    expect(loadWorkflowProvenance(process.cwd())).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
