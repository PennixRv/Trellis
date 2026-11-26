import fs from "node:fs";
import path from "node:path";
import { computeHash } from "./template-hash.js";

export const CODEX_CONFIG_PATH = ".codex/config.toml";
const begin = "# TRELLIS:CODEX-CONFIG:START";
const end = /^# TRELLIS:CODEX-CONFIG:END\r?\n/m;
// The exact unmarked seed shipped before scoped ownership. Old mixed receipts
// may include user content and never authorize an edit.
const legacySeed =
  "98c58f0895564af168051418208b755ff05001f8780fe90e76e0490e90100240";

/** null means absent; undefined means not safe to read or write. */
export function readCodexConfig(file: string): string | null | undefined {
  try {
    if (!fs.lstatSync(path.dirname(file)).isDirectory()) return undefined;
    if (!fs.lstatSync(file).isFile()) return undefined;
    const raw = fs.readFileSync(file);
    const text = raw.toString("utf8");
    return raw.equals(Buffer.from(text)) ? text : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return undefined;
  }
}

export function splitCodexConfig(
  content: string,
): { prefix: string; suffix: string } | undefined {
  if (
    !content.startsWith(`${begin}\n`) &&
    !content.startsWith(`${begin}\r\n`)
  ) {
    return computeHash(content) === legacySeed
      ? { prefix: content, suffix: "" }
      : undefined;
  }
  const marker = end.exec(content);
  if (!marker) return undefined;
  const offset = marker.index + marker[0].length;
  const prefix = content.slice(0, offset);
  // A generated prefix opens exactly one table. Replacing it must preserve
  // the scope of any user assignments immediately following the marker.
  const body = prefix
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"));
  if (
    body.length !== 3 ||
    !/^project_doc_fallback_filenames = \[(?:"[^"\\]*"(?:, "[^"\\]*")*)?\]$/.test(
      body[0] ?? "",
    ) ||
    body[1] !== "[agents]" ||
    !/^enabled = (true|false)$/.test(body[2] ?? "")
  )
    return undefined;
  return { prefix, suffix: content.slice(offset) };
}

export function ownedCodexConfig(
  content: string,
  receipt?: string,
): { prefix: string; suffix: string } | undefined {
  const parts = splitCodexConfig(content);
  return parts && receipt === computeHash(parts.prefix) ? parts : undefined;
}

export function stripCodexConfigPrefix(suffix: string): string {
  const first = suffix
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  return first && !first.startsWith("[")
    ? `[agents]${suffix.includes("\r\n") ? "\r\n" : "\n"}${suffix}`
    : suffix;
}
