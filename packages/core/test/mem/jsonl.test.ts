import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJsonl, readJsonlFirst } from "../../src/mem/internal/jsonl.js";

describe("streaming JSONL reader", () => {
  let directory: string;
  let file: string;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-jsonl-test-"));
    file = path.join(directory, "events.jsonl");
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
  it.each([
    ["中", 1],
    ["中", 2],
    ["😀", 1],
    ["😀", 2],
    ["😀", 3],
  ])(
    "preserves %s split after %i bytes at a chunk boundary and EOF",
    (character, bytes) => {
      const text =
        "x".repeat(
          256 * 1024 - Buffer.byteLength('{"text":"') - Number(bytes),
        ) + character;
      fs.writeFileSync(file, JSON.stringify({ text }));
      const rows: { text: string }[] = [];
      readJsonl<{ text: string }>(file, (row) => rows.push(row));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.text === text).toBe(true);
      expect(rows[0]?.text.slice(-String(character).length)).toBe(character);
    },
  );
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
