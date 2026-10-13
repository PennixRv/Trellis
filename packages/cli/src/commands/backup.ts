import fs from "node:fs";
import path from "node:path";

import { DIR_NAMES } from "../constants/paths.js";

export const BACKUP_COMPLETE_MARKER = ".backup-complete";
const BACKUP_PREFIX = ".backup-";
const BACKUP_PRUNE_LOCK = ".backup-prune.lock";
const DEFAULT_KEEP = 3;

export interface BackupInfo {
  name: string;
  path: string;
  state: "complete" | "unknown";
  bytes: number;
  mtimeMs: number;
}

export interface BackupPruneResult {
  backups: BackupInfo[];
  protectedNames: string[];
  removedNames: string[];
  blockedReason?: string;
}

export function listBackups(cwd = process.cwd()): BackupInfo[] {
  const root = path.join(cwd, DIR_NAMES.WORKFLOW);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter(
      (entry) =>
        entry.name.startsWith(BACKUP_PREFIX) &&
        entry.name !== BACKUP_PRUNE_LOCK,
    )
    .map((entry) => {
      const backupPath = path.join(root, entry.name);
      try {
        const stat = fs.lstatSync(backupPath);
        const complete =
          stat.isDirectory() &&
          fs.statSync(path.join(backupPath, BACKUP_COMPLETE_MARKER)).isFile();
        return {
          name: entry.name,
          path: backupPath,
          state: complete ? "complete" : "unknown",
          bytes: stat.isDirectory() ? directorySize(backupPath) : 0,
          mtimeMs: stat.mtimeMs,
        } satisfies BackupInfo;
      } catch {
        return {
          name: entry.name,
          path: backupPath,
          state: "unknown",
          bytes: 0,
          mtimeMs: 0,
        } satisfies BackupInfo;
      }
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
}

export function pruneBackups(
  cwd = process.cwd(),
  {
    keep = DEFAULT_KEEP,
    confirm = false,
  }: { keep?: number; confirm?: boolean } = {},
): BackupPruneResult {
  if (!Number.isSafeInteger(keep) || keep < DEFAULT_KEEP) {
    throw new Error(`backup --keep must be an integer >= ${DEFAULT_KEEP}`);
  }
  const root = path.join(cwd, DIR_NAMES.WORKFLOW);
  const backups = listBackups(cwd);
  const marker = path.join(root, BACKUP_PRUNE_LOCK);
  if (fs.existsSync(marker)) {
    return {
      backups,
      protectedNames: backups.map((backup) => backup.name),
      removedNames: [],
      blockedReason: "backup maintenance is already in progress",
    };
  }
  if (backups.some((backup) => backup.state === "unknown")) {
    return {
      backups,
      protectedNames: backups.map((backup) => backup.name),
      removedNames: [],
      blockedReason: "an unknown or incomplete backup is present",
    };
  }
  const complete = backups.filter((backup) => backup.state === "complete");
  const protectedNames = complete.slice(0, keep).map((backup) => backup.name);
  const candidates = complete.slice(keep);
  if (!confirm || candidates.length === 0) {
    return {
      backups,
      protectedNames,
      removedNames: candidates.map((backup) => backup.name),
    };
  }

  fs.mkdirSync(root, { recursive: true });
  const fd = fs.openSync(marker, "wx");
  try {
    const current = listBackups(cwd);
    if (current.some((backup) => backup.state === "unknown")) {
      return {
        backups: current,
        protectedNames: current.map((backup) => backup.name),
        removedNames: [],
        blockedReason: "backup state changed during confirmation",
      };
    }
    const currentComplete = current.filter(
      (backup) => backup.state === "complete",
    );
    const currentCandidates = currentComplete.slice(keep);
    for (const backup of currentCandidates) {
      fs.rmSync(backup.path, { recursive: true, force: false });
    }
    return {
      backups: current,
      protectedNames: currentComplete
        .slice(0, keep)
        .map((backup) => backup.name),
      removedNames: currentCandidates.map((backup) => backup.name),
    };
  } finally {
    fs.closeSync(fd);
    fs.rmSync(marker, { force: true });
  }
}

function directorySize(root: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) total += directorySize(child);
    else if (entry.isFile()) total += fs.statSync(child).size;
  }
  return total;
}
