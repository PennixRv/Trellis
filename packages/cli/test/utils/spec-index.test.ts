import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureSpecIndex } from "../../src/configurators/workflow.js";

describe("spec root preparation", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-spec-index-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it.each(["", "自定义规范\r\n"])("preserves existing bytes: %j", (content) => {
    fs.mkdirSync(path.join(cwd, ".trellis/spec"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".trellis/spec/index.md"), content);
    expect(ensureSpecIndex(cwd)).toBe("preserved");
    expect(
      fs.readFileSync(path.join(cwd, ".trellis/spec/index.md"), "utf8"),
    ).toBe(content);
  });

  it("creates only the root and keeps a concurrent writer's complete file", () => {
    const link = fs.linkSync;
    vi.spyOn(fs, "linkSync").mockImplementation((source, target) => {
      fs.writeFileSync(target, "concurrent user rules");
      return link(source, target);
    });
    expect(ensureSpecIndex(cwd)).toBe("preserved");
    expect(fs.readdirSync(path.join(cwd, ".trellis/spec"))).toEqual([
      "index.md",
    ]);
    expect(
      fs.readFileSync(path.join(cwd, ".trellis/spec/index.md"), "utf8"),
    ).toBe("concurrent user rules");
  });

  it("cleans its temporary on publication failure without a partial target", () => {
    vi.spyOn(fs, "linkSync").mockImplementation(() => {
      throw new Error("publication denied");
    });
    expect(() => ensureSpecIndex(cwd)).toThrow("publication denied");
    expect(fs.readdirSync(path.join(cwd, ".trellis/spec"))).toEqual([]);
  });

  it.each([".trellis/spec", ".trellis/spec/index.md"])(
    "rejects symlinks at %s without touching the target",
    (relative) => {
      const outside = fs.mkdtempSync(
        path.join(os.tmpdir(), "trellis-spec-outside-"),
      );
      try {
        fs.writeFileSync(path.join(outside, "index.md"), "external rules");
        const target = path.join(cwd, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.symlinkSync(
          relative.endsWith("index.md")
            ? path.join(outside, "index.md")
            : outside,
          target,
          relative.endsWith("index.md") ? "file" : "dir",
        );
        expect(() => ensureSpecIndex(cwd)).toThrow();
        expect(fs.readdirSync(outside)).toEqual(["index.md"]);
        expect(fs.readFileSync(path.join(outside, "index.md"), "utf8")).toBe(
          "external rules",
        );
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it("rejects a directory at the file target", () => {
    fs.mkdirSync(path.join(cwd, ".trellis/spec/index.md"), { recursive: true });
    expect(() => ensureSpecIndex(cwd)).toThrow("Unsafe spec path");
    expect(
      fs.statSync(path.join(cwd, ".trellis/spec/index.md")).isDirectory(),
    ).toBe(true);
  });

  it("rejects an unreadable config rather than guessing local ownership", () => {
    fs.mkdirSync(path.join(cwd, ".trellis"));
    const config = path.join(cwd, ".trellis/config.yaml");
    fs.writeFileSync(config, "# owned configuration\n");
    const read = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation(((file, options) => {
      if (file === config) throw new Error("config access denied");
      return read(file, options);
    }) as typeof fs.readFileSync);
    expect(() => ensureSpecIndex(cwd)).toThrow("config access denied");
    expect(fs.existsSync(path.join(cwd, ".trellis/spec"))).toBe(false);
  });
});
