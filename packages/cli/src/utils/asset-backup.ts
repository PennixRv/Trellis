import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { assertCurrentExecutionAsset } from "./retired-native-assets.js";
import path from "node:path";
import { z } from "zod";
import { VERSION } from "../constants/version.js";
import {
  ALL_MANAGED_DIRS,
  getConfiguredPlatforms,
} from "../configurators/index.js";
import { getAllMigrations } from "../migrations/index.js";
import { loadHashes } from "./template-hash.js";
import { writeFileAtomic } from "./atomic-write.js";
import { TRELLIS_BLOCK_START, TRELLIS_BLOCK_END } from "./managed-paths.js";
import { managedBlock, readManagedMarkdown } from "./managed-markdown.js";
import {
  canonicalProjectRoot,
  projectKey,
  fingerprintPath,
  fingerprintsEqual,
  getTransactionPaths,
  loadAblationTransaction,
  withAblationProjectLock,
} from "./ablation-store.js";
import { validateManagedRelativePath } from "./managed-removal.js";

const fileSchema = z
  .object({
    kind: z.literal("file"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().nonnegative(),
    mode: z.number().int().min(0).max(0o7777),
  })
  .strict();
const fingerprintSchema = z.union([
  fileSchema,
  z.object({ kind: z.literal("absent") }).strict(),
]);
const entrySchema = z
  .object({
    path: z.string(),
    before: fingerprintSchema,
    after: fingerprintSchema.optional(),
    afterBlock: z.string().optional(),
  })
  .strict();
const manifestSchema = z
  .object({
    schema: z.literal(1),
    contract: z.literal("status-layout-v1/five-phases-v1"),
    id: z.string(),
    projectRoot: z.string(),
    projectKey: z.string(),
    createdAt: z.string().datetime(),
    version: z.string(),
    sourceVersion: z.string(),
    workflow: z.string(),
    platforms: z.array(z.string()),
    runtime: z.record(z.string(), fingerprintSchema),
    reason: z.enum(["manual", "update", "restore-recovery"]),
    update: z.enum(["pending", "succeeded", "restored", "not-applicable"]),
    entries: z.array(entrySchema),
    restore: z
      .object({
        status: z.enum(["restoring", "complete"]),
        review: z.string(),
        recovery: z.string(),
        entries: z.array(
          z
            .object({
              path: z.string(),
              current: fingerprintSchema,
              desired: fingerprintSchema,
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AssetBackup = z.infer<typeof manifestSchema>;
type Fingerprint = z.infer<typeof fingerprintSchema>;
const BACKUP_ID = /^\.backup-\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]{36}$/;
const LEGACY_ID = /^\.backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{3}Z)?$/;
const META = [".trellis/.version", ".trellis/.template-hashes.json"];
const RUNTIME = [
  ".trellis/scripts/common/task_layout.py",
  ".trellis/scripts/common/task_workflow.py",
];
const PROTECTED =
  /(?:^|\/)(?:tasks|spec|workspace|backlog|session-handoffs|sessions|history|logs?|cache|node_modules|worktrees?|agent-traces|\.runtime|\.git|credentials?|secrets?)(?:\/|$)|(?:^|\/)\.backup-|(?:^|\/)\.env(?:\.|$)|(?:^|\/)(?:\.developer|\.task-layout-migration\.json)$/i;

/** Permit managed symlinks only when their resolved target stays in-project. */
function safePath(root: string, relative: string): string {
  validateManagedRelativePath(relative);
  root = canonicalProjectRoot(root);
  if (relative === "AGENTS.md") readManagedMarkdown(path.join(root, relative));
  let cursor = root;
  for (const part of relative.split("/")) {
    cursor = path.join(cursor, part);
    try {
      const stat = fs.lstatSync(cursor);
      const resolved = fs.realpathSync(cursor);
      const rel = path.relative(root, resolved);
      if (
        rel === ".." ||
        rel.startsWith(`..${path.sep}`) ||
        path.isAbsolute(rel)
      )
        throw new Error(`Asset path escapes project root: ${relative}`);
      const targetStat = stat.isSymbolicLink() ? fs.statSync(cursor) : stat;
      if (cursor !== path.join(root, relative) && !targetStat.isDirectory())
        throw new Error(`Invalid asset parent: ${relative}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  try {
    return fs.realpathSync(cursor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return cursor;
  }
}

function assetPath(relative: string): boolean {
  validateManagedRelativePath(relative);
  return (
    !PROTECTED.test(relative) &&
    (relative === "AGENTS.md" ||
      ALL_MANAGED_DIRS.some(
        (entry) => relative === entry || relative.startsWith(`${entry}/`),
      ))
  );
}

function current(root: string, relative: string): Fingerprint {
  const fp = fingerprintPath(safePath(root, relative));
  if (fp.kind !== "file" && fp.kind !== "absent")
    throw new Error(`Asset must be a regular file: ${relative}`);
  return fp;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function block(content: string): string | undefined {
  return (
    managedBlock(content, TRELLIS_BLOCK_START, TRELLIS_BLOCK_END) ?? undefined
  );
}

function backupDir(root: string, id: string): string {
  if (!BACKUP_ID.test(id)) throw new Error(`Invalid asset backup id: ${id}`);
  return safePath(root, `.trellis/${id}`);
}

function save(root: string, backup: AssetBackup): void {
  const dir = backupDir(root, backup.id);
  const file = safePath(dir, "manifest.json");
  writeFileAtomic(
    file,
    `${JSON.stringify(manifestSchema.parse(backup), null, 2)}\n`,
    0o600,
  );
}

export function loadAssetBackup(root: string, id: string): AssetBackup {
  root = canonicalProjectRoot(root);
  const dir = backupDir(root, id);
  const result = manifestSchema.parse(
    JSON.parse(fs.readFileSync(safePath(dir, "manifest.json"), "utf-8")),
  );
  if (
    result.id !== id ||
    result.projectRoot !== root ||
    result.projectKey !== projectKey(root)
  )
    throw new Error("Asset backup belongs to a different project.");
  const paths = new Set<string>();
  for (const entry of result.entries) {
    if (!assetPath(entry.path) || paths.has(entry.path))
      throw new Error(`Invalid or duplicate asset scope: ${entry.path}`);
    paths.add(entry.path);
    const stored = current(dir, `files/${entry.path}`);
    if (!fingerprintsEqual(stored, entry.before))
      throw new Error(`Asset backup integrity failure: ${entry.path}`);
  }
  if (result.restore) {
    if (result.restore.entries.length !== result.entries.length)
      throw new Error("Invalid restore scope.");
    for (const entry of result.restore.entries)
      if (!paths.delete(entry.path)) throw new Error("Invalid restore path.");
  }
  if (
    treeSize(dir).files !==
    1 + result.entries.filter((entry) => entry.before.kind === "file").length
  )
    throw new Error(
      "Unexpected files in asset backup; retained for inspection.",
    );
  return result;
}

export function assetBackupScope(
  root: string,
  extra: Iterable<string> = [],
): string[] {
  return [...new Set([...Object.keys(loadHashes(root)), ...META, ...extra])]
    .filter(assetPath)
    .sort();
}

/** Caller holds the shared maintenance lock through the associated asset writes. */
export function createAssetBackup(
  root: string,
  reason: AssetBackup["reason"] = "manual",
  paths = assetBackupScope(root),
): AssetBackup {
  root = canonicalProjectRoot(root);
  const id = `.backup-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const dir = backupDir(root, id);
  const staging = safePath(root, `.trellis/.backup-preparing-${randomUUID()}`);
  const scope = [...new Set(paths)].sort();
  const entries = scope.map((relative) => {
    if (!assetPath(relative))
      throw new Error(`Protected or unmanaged asset: ${relative}`);
    return { path: relative, before: current(root, relative) };
  });
  fs.mkdirSync(staging, { mode: 0o700 });
  for (const entry of entries) {
    if (entry.before.kind === "absent") continue;
    const source = safePath(root, entry.path);
    const target = safePath(staging, `files/${entry.path}`);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    if (process.platform !== "win32") fs.chmodSync(target, entry.before.mode);
    if (
      !fingerprintsEqual(
        current(staging, `files/${entry.path}`),
        entry.before,
      ) ||
      !fingerprintsEqual(current(root, entry.path), entry.before)
    )
      throw new Error(`Asset changed during backup: ${entry.path}`);
  }
  const versionFile = safePath(root, ".trellis/.version");
  const workflowFile = safePath(root, ".trellis/workflow.md");
  const backup: AssetBackup = {
    schema: 1,
    contract: "status-layout-v1/five-phases-v1",
    id,
    projectRoot: root,
    projectKey: projectKey(root),
    createdAt: new Date().toISOString(),
    version: VERSION,
    sourceVersion: fs.existsSync(versionFile)
      ? fs.readFileSync(versionFile, "utf-8").trim()
      : "unknown",
    workflow: fs.existsSync(workflowFile)
      ? digest(fs.readFileSync(workflowFile))
      : "absent",
    runtime: Object.fromEntries(
      RUNTIME.map((relative) => [relative, current(root, relative)]),
    ),
    platforms: [...getConfiguredPlatforms(root)],
    reason,
    update: reason === "update" ? "pending" : "not-applicable",
    entries,
  };
  fs.writeFileSync(
    path.join(staging, "manifest.json"),
    `${JSON.stringify(manifestSchema.parse(backup), null, 2)}\n`,
    { mode: 0o600, flag: "wx" },
  );
  fs.renameSync(staging, dir);
  return loadAssetBackup(root, id);
}

export function bindAssetUpdate(root: string, id: string): void {
  const backup = loadAssetBackup(root, id);
  for (const entry of backup.entries) {
    entry.after = current(root, entry.path);
    if (entry.path === "AGENTS.md" && entry.after.kind === "file") {
      const managed = block(
        readManagedMarkdown(safePath(root, entry.path)) ?? "",
      );
      if (managed !== undefined) entry.afterBlock = digest(managed);
    }
  }
  backup.update = "succeeded";
  save(root, backup);
}

export interface BackupInventoryItem {
  id: string;
  path: string;
  kind: "complete" | "legacy" | "sidecar" | "protected";
  bytes: number;
  files: number;
  fingerprint: string;
  problem?: string;
}

function treeSize(root: string): { bytes: number; files: number } {
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error("Symlink in backup storage.");
  if (stat.isFile()) return { bytes: stat.size, files: 1 };
  if (!stat.isDirectory())
    throw new Error("Unsupported backup storage object.");
  const total = { bytes: 0, files: 0 };
  for (const name of fs.readdirSync(root)) {
    const size = treeSize(path.join(root, name));
    total.bytes += size.bytes;
    total.files += size.files;
  }
  return total;
}

export function listAssetBackups(root: string): BackupInventoryItem[] {
  const workflow = safePath(root, ".trellis");
  if (!fs.existsSync(workflow)) return [];
  const result: BackupInventoryItem[] = [];
  const activeRecovery = new Set<string>();
  for (const id of fs
    .readdirSync(workflow)
    .filter((name) => name.startsWith(".backup-"))
    .sort()) {
    const relative = `.trellis/${id}`;
    const item: BackupInventoryItem = {
      id,
      path: relative,
      kind: "protected",
      bytes: 0,
      files: 0,
      fingerprint: "",
    };
    try {
      const location = safePath(root, relative);
      Object.assign(item, treeSize(location));
      item.fingerprint = digest(fingerprintPath(location));
      if (BACKUP_ID.test(id)) {
        const backup = loadAssetBackup(root, id);
        if (backup.restore?.status === "restoring")
          activeRecovery.add(backup.restore.recovery);
        if (
          backup.update === "pending" ||
          backup.restore?.status === "restoring"
        )
          item.problem = `Unresolved update or restore; inspect before cleanup. To recover explicitly: trellis backup restore ${id} --replace-modified`;
        else item.kind = "complete";
      } else if (LEGACY_ID.test(id)) {
        const names = fs.readdirSync(location);
        const roots = new Set(ALL_MANAGED_DIRS.map((dir) => dir.split("/")[0]));
        if (
          !names.length ||
          !names.some((name) => name === ".trellis" || name === "AGENTS.md") ||
          names.some(
            (name) =>
              name !== "AGENTS.md" &&
              name !== ".backup-complete" &&
              !roots.has(name),
          )
        )
          throw new Error("Unknown legacy backup scope.");
        const marker = path.join(location, ".backup-complete");
        if (
          fs.existsSync(marker) &&
          !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(
            fs.readFileSync(marker, "utf-8").trim(),
          )
        )
          throw new Error("Unknown legacy completion marker.");
        item.kind = "legacy";
      } else item.problem = "Unknown or incomplete backup; retained.";
    } catch (error) {
      item.problem = error instanceof Error ? error.message : String(error);
    }
    result.push(item);
  }
  for (const item of result) {
    if (activeRecovery.has(item.id)) {
      item.kind = "protected";
      item.problem = "Unresolved restore depends on this recovery snapshot.";
    }
  }
  const owned = new Set([
    ...Object.keys(loadHashes(root)),
    ...getAllMigrations().flatMap((item) => [
      item.from,
      ...(item.to ? [item.to] : []),
    ]),
  ]);
  for (const original of owned) {
    if (!assetPath(original)) continue;
    const relative = `${original}.backup`;
    try {
      const location = safePath(root, relative);
      if (!fs.existsSync(location)) continue;
      if (!fs.lstatSync(path.join(root, relative)).isFile())
        throw new Error("Migration sidecar is not a regular file; retained.");
      const size = treeSize(location);
      result.push({
        id: relative,
        path: relative,
        kind: "sidecar",
        ...size,
        fingerprint: digest(fingerprintPath(location)),
      });
    } catch (error) {
      result.push({
        id: relative,
        path: relative,
        kind: "protected",
        bytes: 0,
        files: 0,
        fingerprint: "",
        problem: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

export function assertNoAssetRecovery(root: string): void {
  const active = listAssetBackups(root).filter((item) =>
    item.problem?.startsWith("Unresolved"),
  );
  if (active.length)
    throw new Error(
      `Unresolved asset recovery: ${active.map((item) => item.id).join(", ")}. Inspect the backup before changing assets.`,
    );
}

export function withAssetMaintenance<T>(
  root: string,
  operation: () => T,
  readOnly = false,
): T {
  if (readOnly) return operation();
  return withAblationProjectLock(getTransactionPaths(root), () => {
    if (loadAblationTransaction(root))
      throw new Error(
        "An ablation transaction exists; use trellis restore first.",
      );
    assertNoAssetRecovery(root);
    return operation();
  });
}

export function pruneAssetBackups(
  root: string,
  options: {
    all?: boolean;
    includeLegacy?: boolean;
    yes?: boolean;
    keep?: number;
  } = {},
): {
  selected: BackupInventoryItem[];
  protected: BackupInventoryItem[];
  deleted: string[];
  failed: { path: string; error: string }[];
} {
  const inventory = listAssetBackups(root);
  const keep = options.keep ?? 3;
  if (!Number.isSafeInteger(keep) || keep < 3)
    throw new Error(
      "Daily retention requires at least three complete backups; use explicit --all for full cleanup.",
    );
  if (options.includeLegacy && !options.all)
    throw new Error("Legacy cleanup requires --all --include-legacy.");
  const eligible = inventory.filter((item) => item.kind === "complete");
  const selected = options.all
    ? inventory.filter(
        (item) =>
          item.kind === "complete" ||
          (options.includeLegacy &&
            (item.kind === "legacy" || item.kind === "sidecar")),
      )
    : eligible.slice(0, Math.max(0, eligible.length - keep));
  const report = {
    selected,
    protected: inventory.filter((item) => !selected.includes(item)),
    deleted: [] as string[],
    failed: [] as { path: string; error: string }[],
  };
  if (!options.yes) return report;
  if (loadAblationTransaction(root))
    throw new Error("An ablation transaction exists; cleanup is blocked.");
  for (const item of selected) {
    try {
      const latest = listAssetBackups(root).find(
        (candidate) => candidate.path === item.path,
      );
      if (latest?.kind !== item.kind || latest.fingerprint !== item.fingerprint)
        throw new Error("Backup changed since cleanup preflight.");
      const location = safePath(root, item.path);
      treeSize(location);
      fs.rmSync(location, { recursive: true });
      report.deleted.push(item.path);
    } catch (error) {
      report.failed.push({
        path: item.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}

export interface AssetRestorePlan {
  id: string;
  review: string;
  entries: {
    path: string;
    action: "write" | "delete" | "keep" | "conflict";
    current: Fingerprint;
    desired: Fingerprint;
  }[];
}

function desiredContent(
  root: string,
  backup: AssetBackup,
  relative: string,
): Buffer | undefined {
  const entry = backup.entries.find((item) => item.path === relative);
  if (!entry || entry.before.kind === "absent") return undefined;
  const stored = fs.readFileSync(
    safePath(backupDir(root, backup.id), `files/${relative}`),
  );
  if (relative !== "AGENTS.md" || current(root, relative).kind === "absent")
    return stored;
  const previous = block(
    readManagedMarkdown(
      safePath(backupDir(root, backup.id), `files/${relative}`),
    ) ?? "",
  );
  const now = readManagedMarkdown(safePath(root, relative)) ?? "";
  const active = block(now);
  const offset = now.indexOf(TRELLIS_BLOCK_START);
  return previous && active
    ? Buffer.from(
        now.slice(0, offset) + previous + now.slice(offset + active.length),
      )
    : stored;
}

export function planAssetRestore(
  root: string,
  id: string,
  replaceModified = false,
): AssetRestorePlan {
  const backup = loadAssetBackup(root, id);
  // Asset rollback cannot roll back task data; require the exact task runtime.
  if (
    Object.keys(backup.runtime).length !== RUNTIME.length ||
    RUNTIME.some((relative) => {
      const recorded = backup.runtime[relative];
      return (
        recorded?.kind !== "file" ||
        !fingerprintsEqual(recorded, current(root, relative))
      );
    })
  )
    throw new Error(
      "Task layout/phase runtime compatibility cannot be verified; assets were not changed.",
    );
  const entries = backup.entries.map((entry) => {
    const actual = current(root, entry.path);
    const data = desiredContent(root, backup, entry.path);
    if (data !== undefined)
      assertCurrentExecutionAsset(entry.path, data.toString("utf8"));
    const desired: Fingerprint =
      data === undefined
        ? { kind: "absent" }
        : {
            kind: "file",
            sha256: createHash("sha256").update(data).digest("hex"),
            size: data.length,
            mode: entry.before.kind === "file" ? entry.before.mode : 0o644,
          };
    const resumed =
      backup.restore?.status === "restoring"
        ? backup.restore.entries.find((item) => item.path === entry.path)
        : undefined;
    const mixedMatch =
      entry.path === "AGENTS.md" &&
      entry.before.kind === "file" &&
      block(
        readManagedMarkdown(
          safePath(backupDir(root, id), `files/${entry.path}`),
        ) ?? "",
      ) !== undefined &&
      entry.afterBlock !== undefined &&
      actual.kind === "file" &&
      digest(block(readManagedMarkdown(safePath(root, entry.path)) ?? "")) ===
        entry.afterBlock;
    const safe = resumed
      ? fingerprintsEqual(actual, resumed.current) ||
        fingerprintsEqual(actual, resumed.desired)
      : entry.after !== undefined &&
        (fingerprintsEqual(actual, entry.after) || mixedMatch);
    const same = fingerprintsEqual(actual, desired);
    const unsafeMixedRestore =
      entry.path === "AGENTS.md" && !same && !resumed && !safe;
    const action: AssetRestorePlan["entries"][number]["action"] =
      unsafeMixedRestore
        ? "conflict"
        : same
          ? "keep"
          : safe || (replaceModified && !resumed)
            ? desired.kind === "absent"
              ? "delete"
              : "write"
            : "conflict";
    return { path: entry.path, current: actual, desired, action };
  });
  return { id, review: digest({ id, replaceModified, entries }), entries };
}

export function restoreAssetBackup(
  root: string,
  id: string,
  options: { review?: string; replaceModified?: boolean; yes?: boolean } = {},
): AssetRestorePlan {
  const plan = planAssetRestore(root, id, options.replaceModified);
  if (!options.yes) return plan;
  if (options.review !== plan.review)
    throw new Error(
      "Restore requires the current preview --review digest; preview again after any change.",
    );
  if (plan.entries.some((entry) => entry.action === "conflict"))
    throw new Error("Restore conflicts remain; no assets changed.");
  const backup = loadAssetBackup(root, id);
  if (!backup.restore || backup.restore.status === "complete") {
    const recovery = createAssetBackup(
      root,
      "restore-recovery",
      backup.entries.map((entry) => entry.path),
    );
    backup.restore = {
      status: "restoring",
      review: plan.review,
      recovery: recovery.id,
      entries: plan.entries.map(
        ({ path: relative, current: actual, desired }) => ({
          path: relative,
          current: actual,
          desired,
        }),
      ),
    };
    save(root, backup);
  }
  for (const entry of plan.entries) {
    if (entry.action === "keep") continue;
    const target = safePath(root, entry.path);
    if (!fingerprintsEqual(current(root, entry.path), entry.current))
      throw new Error(`Asset changed during restore: ${entry.path}`);
    if (entry.action === "delete") fs.unlinkSync(target);
    else {
      const data = desiredContent(root, backup, entry.path);
      if (data === undefined || entry.desired.kind !== "file")
        throw new Error("Missing restore payload.");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      writeFileAtomic(target, data, entry.desired.mode);
    }
    if (!fingerprintsEqual(current(root, entry.path), entry.desired))
      throw new Error(`Restore verification failed: ${entry.path}`);
  }
  if (!backup.restore) throw new Error("Missing restore transaction.");
  backup.restore.status = "complete";
  if (backup.update === "pending") backup.update = "restored";
  save(root, backup);
  return plan;
}
