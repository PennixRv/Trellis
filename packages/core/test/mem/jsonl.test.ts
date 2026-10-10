import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readJsonl, readJsonlFirst } from "../../src/mem/internal/jsonl.js";

describe("readJsonl", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-jsonl-"));
    file = path.join(dir, "events.jsonl");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it.each([
    ["中", 1], ["中", 2], ["😀", 1], ["😀", 2], ["😀", 3],
  ])("preserves %s when %i bytes precede the chunk boundary", (character, bytes) => {
    const text = "x".repeat(256 * 1024 - Buffer.byteLength('{"text":"') - Number(bytes)) + character;
    // No final newline exercises the decoder's EOF path too.
    fs.writeFileSync(file, JSON.stringify({ text }));
    const rows: { text: string }[] = [];
    readJsonl<{ text: string }>(file, (row) => rows.push(row));
    expect(rows).toEqual([{ text }]);
    expect(rows[0]?.text).not.toContain("\uFFFD");
  });

  it("skips malformed rows and stops before later valid rows", () => {
    fs.writeFileSync(file, 'preamble\n{broken\n{"value":1}\n{"value":2}\n');
    const rows: { value: number }[] = [];
    readJsonl<{ value: number }>(file, (row) => {
      rows.push(row);
      return "stop";
    });
    expect(rows).toEqual([{ value: 1 }]);
    expect(readJsonlFirst(file)).toEqual({ value: 1 });
  });
});
