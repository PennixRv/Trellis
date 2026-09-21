import fs from "node:fs";
import path from "node:path";

import { isManagedPath, isManagedRootDir } from "../configurators/index.js";

export const TRELLIS_BLOCK_START = "<!-- TRELLIS:START -->";
export const TRELLIS_BLOCK_END = "<!-- TRELLIS:END -->";

/** Return the first complete managed block, if the document has one. */
export function getManagedMarkdownBlock(
  content: string,
  startMarker: string,
  endMarker: string,
): string | null {
  const start = content.indexOf(startMarker);
  if (start === -1) return null;

  const end = content.indexOf(endMarker, start);
  if (end === -1) return null;

  return content.slice(start, end + endMarker.length);
}

/**
 * Replace a complete managed block, or append the template's block while
 * preserving all user-authored content around it.
 */
export function mergeManagedMarkdownBlock(
  existingContent: string,
  templateContent: string,
  startMarker: string,
  endMarker: string,
): string | null {
  const firstStart = existingContent.indexOf(startMarker);
  const firstEnd = existingContent.indexOf(endMarker);
  const templateBlock = getManagedMarkdownBlock(
    templateContent,
    startMarker,
    endMarker,
  );

  if (!templateBlock) return templateContent;
  if (firstStart === -1 && firstEnd === -1) {
    const trimmed = existingContent.replace(/\s+$/, "");
    return `${trimmed}\n\n${templateBlock}\n`;
  }
  if (
    firstStart === -1 ||
    firstEnd === -1 ||
    firstEnd < firstStart ||
    existingContent.indexOf(startMarker, firstStart + startMarker.length) !==
      -1 ||
    existingContent.indexOf(endMarker, firstEnd + endMarker.length) !== -1
  ) {
    return null;
  }

  const existingEnd = existingContent.indexOf(endMarker, firstStart);
  if (existingEnd !== -1) {
    return (
      existingContent.slice(0, firstStart) +
      templateBlock +
      existingContent.slice(existingEnd + endMarker.length)
    );
  }

  return null;
}

/** Remove empty managed parents without deleting a managed root directory. */
export function cleanupEmptyDirs(cwd: string, dirPath: string): void {
  const dirPosix = dirPath.replace(/\\/g, "/");
  const segments = dirPosix.split("/");

  if (
    path.posix.isAbsolute(dirPosix) ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    ) ||
    !isManagedPath(dirPosix) ||
    isManagedRootDir(dirPosix)
  ) {
    return;
  }

  const canonicalCwd = fs.realpathSync(cwd);
  const fullPath = path.resolve(canonicalCwd, ...segments);
  const relative = path.relative(canonicalCwd, fullPath);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return;
  }
  if (!fs.existsSync(fullPath)) return;

  try {
    const canonicalFullPath = fs.realpathSync(fullPath);
    const canonicalRelative = path.relative(canonicalCwd, canonicalFullPath);
    if (
      canonicalRelative === "" ||
      canonicalRelative === ".." ||
      canonicalRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(canonicalRelative)
    ) {
      return;
    }

    const stat = fs.lstatSync(fullPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;

    if (fs.readdirSync(fullPath).length === 0) {
      fs.rmdirSync(fullPath);
      const parent = path.posix.dirname(dirPosix);
      if (parent !== "." && parent !== dirPosix && !isManagedRootDir(parent)) {
        cleanupEmptyDirs(cwd, parent);
      }
    }
  } catch {
    // Cleanup is best-effort; permission/race failures leave the directory.
  }
}
