import fs from "node:fs";

/** Refuse ambiguous ownership rather than repairing a shared document. */
export function managedBlock(
  content: string,
  start: string,
  end: string,
): string | null {
  const first = content.indexOf(start);
  const last = content.indexOf(end);
  if (first === -1 && last === -1) return null;
  if (
    first < 0 ||
    last < first ||
    content.indexOf(start, first + 1) !== -1 ||
    content.indexOf(end, last + 1) !== -1
  ) {
    throw new Error("Malformed managed Markdown markers");
  }
  const finish = last + end.length;
  const markers = /<!--\s*([^<>\r\n]+?)\s*-->/g;
  const stack: string[] = [];
  for (const match of content.matchAll(markers)) {
    const token = match[0];
    if (token === start || token === end) {
      if (stack.length) throw new Error("Nested managed Markdown blocks");
      continue;
    }
    const tag = /^(.*?)(?::|_|\s+)(START|END)$/i.exec(match[1]);
    if (!tag) continue;
    if (match.index > first && match.index < finish)
      throw new Error("Nested managed Markdown blocks");
    if (tag[2].toUpperCase() === "START") stack.push(tag[1]);
    else if (stack.at(-1) === tag[1]) stack.pop();
  }
  return content.slice(first, finish);
}

export function mergeManagedMarkdown(
  content: string,
  template: string,
  start: string,
  end: string,
): string {
  const previous = managedBlock(content, start, end);
  const next = managedBlock(template, start, end);
  if (!next) throw new Error("Template lacks managed Markdown block");
  if (previous) {
    const offset = content.indexOf(start);
    return (
      content.slice(0, offset) + next + content.slice(offset + previous.length)
    );
  }
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const merged =
    content + (content.length ? newline + newline : "") + next + newline;
  managedBlock(merged, start, end);
  return merged;
}

export function readManagedMarkdown(file: string): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`Managed Markdown must be a regular file: ${file}`);
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    fs.readFileSync(file),
  );
}
