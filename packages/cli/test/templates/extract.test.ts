import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readdirSync: vi.fn(actual.readdirSync) };
});
import {
  getTrellisTemplatePath,
  getClaudeTemplatePath,
  getOpenCodeTemplatePath,
  getPiTemplatePath,
  getPiSourcePath,
  getTrellisSourcePath,
  readTrellisFile,
  readTemplate,
  readScript,
  readMarkdown,
  copyTrellisDir,
} from "../../src/templates/extract.js";

// =============================================================================
// getXxxTemplatePath — returns existing directory paths
// =============================================================================

describe("template path functions", () => {
  it("getTrellisTemplatePath returns existing directory", () => {
    const p = getTrellisTemplatePath();
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.statSync(p).isDirectory()).toBe(true);
  });

  it("getClaudeTemplatePath returns existing directory", () => {
    const p = getClaudeTemplatePath();
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.statSync(p).isDirectory()).toBe(true);
  });

  it("getOpenCodeTemplatePath returns existing directory", () => {
    const p = getOpenCodeTemplatePath();
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.statSync(p).isDirectory()).toBe(true);
  });

  it("getPiTemplatePath returns existing directory", () => {
    const p = getPiTemplatePath();
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.statSync(p).isDirectory()).toBe(true);
  });
});

// =============================================================================
// Deprecated aliases return same result
// =============================================================================

describe("deprecated source path aliases", () => {
  it("getTrellisSourcePath equals getTrellisTemplatePath", () => {
    expect(getTrellisSourcePath()).toBe(getTrellisTemplatePath());
  });

  it("getPiSourcePath equals getPiTemplatePath", () => {
    expect(getPiSourcePath()).toBe(getPiTemplatePath());
  });
});

// =============================================================================
// readTrellisFile — reads files from trellis template directory
// =============================================================================

describe("readTrellisFile", () => {
  it("reads workflow.md from trellis templates", () => {
    const content = readTrellisFile("workflow.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("#");
  });

  it("reads a script file", () => {
    const content = readTrellisFile("scripts/task.py");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws for nonexistent file", () => {
    expect(() => readTrellisFile("nonexistent.txt")).toThrow();
  });
});

// =============================================================================
// readTemplate — reads from category subdirectories
// =============================================================================

describe("readTemplate", () => {
  it("throws for nonexistent category/file", () => {
    expect(() => readTemplate("scripts", "nonexistent.txt")).toThrow();
  });
});

// =============================================================================
// readScript / readMarkdown helpers
// =============================================================================

describe("readScript", () => {
  it("reads a Python script from scripts/", () => {
    const content = readScript("task.py");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });
});

describe("readMarkdown", () => {
  it("reads workflow.md", () => {
    const content = readMarkdown("workflow.md");
    expect(typeof content).toBe("string");
    expect(content).toContain("#");
  });
});

it("does not copy Python runtime caches into a project", async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-extract-"));
  const entries = vi
    .mocked(readdirSync)
    .mockReturnValueOnce([
      "__pycache__",
      "stale.pyc",
      "stale.pyo",
      "task.py",
    ] as unknown as ReturnType<typeof fs.readdirSync>);
  try {
    await copyTrellisDir("scripts", dest);
    expect(fs.readdirSync(dest)).toEqual(["task.py"]);
  } finally {
    entries.mockRestore();
    fs.rmSync(dest, { recursive: true, force: true });
  }
});
