import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  managedBlock,
  mergeManagedMarkdown,
  readManagedMarkdown,
} from "../../src/utils/managed-markdown.js";
import { scrubManagedMarkdownBlock } from "../../src/utils/uninstall-scrubbers.js";

const start = "<!-- TRELLIS:START -->";
const end = "<!-- TRELLIS:END -->";
const old = `${start}\nold\n${end}`;
const next = `${start}\nnew\n${end}`;
describe("shared Markdown ownership", () => {
  it("preserves every foreign byte on replace and removal", () => {
    const prefix =
      "\ufeff手工正文  \r\n\r\n\r\n<!-- codegraph:start -->\r\nC\r\n<!-- codegraph:end -->\r\n";
    const suffix = "\r\n\r\n\r\n尾部  \r\n";
    expect(mergeManagedMarkdown(prefix + old + suffix, next, start, end)).toBe(
      prefix + next + suffix,
    );
    expect(
      scrubManagedMarkdownBlock(prefix + old + suffix, start, end).content,
    ).toBe(prefix + suffix);
    expect(
      mergeManagedMarkdown(prefix, next, start, end).startsWith(prefix),
    ).toBe(true);
  });
  it.each([
    start,
    end,
    end + start,
    old + old,
    `${start}<!-- codegraph:start -->C<!-- codegraph:end -->${end}`,
    `<!-- codegraph:start -->${old}<!-- codegraph:end -->`,
    `${start}<!-- CODEGRAPH_START -->C<!-- CODEGRAPH_END -->${end}`,
    `<!-- CODEGRAPH_START -->${old}<!-- CODEGRAPH_END -->`,
  ])("refuses ambiguous input: %s", (input) => {
    expect(() => managedBlock(input, start, end)).toThrow();
  });
  it("does not append inside an unclosed foreign managed block", () => {
    expect(() =>
      mergeManagedMarkdown(
        "policy\n<!-- codegraph:start -->",
        next,
        start,
        end,
      ),
    ).toThrow("Nested");
    expect(() =>
      mergeManagedMarkdown(
        "policy\n<!-- CODEGRAPH_START -->",
        next,
        start,
        end,
      ),
    ).toThrow("Nested");
  });
  it("rejects links, directories and invalid UTF-8 without changing the target", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-md-"));
    try {
      const file = path.join(root, "AGENTS.md");
      const target = path.join(root, "target");
      fs.writeFileSync(target, "policy");
      fs.symlinkSync(target, file);
      expect(() => readManagedMarkdown(file)).toThrow("regular file");
      expect(fs.readFileSync(target, "utf-8")).toBe("policy");
      expect(() => readManagedMarkdown(root)).toThrow("regular file");
      fs.unlinkSync(file);
      fs.writeFileSync(file, Buffer.from([0xff]));
      expect(() => readManagedMarkdown(file)).toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
