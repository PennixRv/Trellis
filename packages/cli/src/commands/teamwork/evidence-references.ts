import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { safePath } from "./artifact.js";

// Read only the semantic core; storage validation and mutation remain with its owner.
const ZIP_CORE = `import hashlib,json,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    entries=archive.infolist()
    names=[entry.filename for entry in entries]
    if len(entries)>128 or len(set(names))!=len(names): raise ValueError("member set")
    core=archive.getinfo("session-handoff.json")
    manifest=archive.getinfo("storage-manifest.json")
    if core.file_size>8*1024*1024 or manifest.file_size>256*1024: raise ValueError("byte budget")
    raw=archive.read(core)
    evidence=json.loads(archive.read(manifest))
    record=evidence["members"][core.filename]
    if evidence["storage_version"]!=1 or evidence["handoff_id"]!=sys.argv[2] or record["bytes"]!=len(raw) or record["sha256"]!=hashlib.sha256(raw).hexdigest(): raise ValueError("core integrity")
    sys.stdout.buffer.write(raw)
`;

export interface EvidenceReferenceCheck {
  scope: string[];
  complete: boolean;
  protected: { source: string; target: string; role: string }[];
  mentions: { source: string; target: string; role: string }[];
  issues: string[];
}

/** Bounded project evidence check, not a global reference registry or a use detector. */
export function inspectEvidenceReferences(
  cwd: string,
  targets: string[],
  sessionId?: string,
): EvidenceReferenceCheck {
  const roots = [
    ".trellis/tasks",
    ".trellis/spec",
    ".trellis/session-handoffs",
    "issues",
    "docs",
  ];
  const result: EvidenceReferenceCheck = {
    scope: roots,
    complete: true,
    protected: [],
    mentions: [],
    issues: [],
  };
  const candidates = new Set(targets.map((file) => path.resolve(file)));
  const documents: string[] = [];
  let bytes = 0;
  let count = 0;
  const addIssue = (message: string): void => {
    result.complete = false;
    result.issues.push(message);
  };
  const walk = (directory: string, depth = 0): void => {
    if (depth > 16 || count > 10000) {
      addIssue("Project evidence scan limit exceeded");
      return;
    }
    if (!fs.existsSync(directory)) return;
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink()) {
      addIssue(`Redirected evidence scope: ${path.relative(cwd, directory)}`);
      return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++count > 10000) {
        addIssue("Project evidence scan limit exceeded");
        return;
      }
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        addIssue(`Redirected evidence member: ${path.relative(cwd, file)}`);
        continue;
      }
      if (entry.isDirectory()) walk(file, depth + 1);
      else if (
        /\.(json|jsonl|md)$/.test(entry.name) ||
        (file.includes(`${path.sep}session-handoffs${path.sep}`) &&
          /^\d{8}T\d{12}Z\.zip$/.test(entry.name))
      ) {
        // Rollout projections and prompt renderings are historical conversation
        // bytes. The semantic handoff core, not copied dialogue, names dependencies.
        if (
          file.includes(`${path.sep}session-handoffs${path.sep}`) &&
          entry.name !== "session-handoff.json" &&
          !entry.name.endsWith(".zip")
        )
          continue;
        documents.push(file);
      }
    }
  };
  try {
    for (const relative of roots) walk(safePath(cwd, relative));
    for (const name of fs.readdirSync(cwd))
      if (name.endsWith(".md") && fs.lstatSync(path.join(cwd, name)).isFile())
        documents.push(path.join(cwd, name));
    for (const file of documents.sort()) {
      const info = fs.lstatSync(file);
      if (!file.endsWith(".zip") && info.size > 8 * 1024 * 1024) {
        addIssue(`Evidence byte limit exceeded: ${path.relative(cwd, file)}`);
        continue;
      }
      let text: string;
      if (file.endsWith(".zip")) {
        const read = spawnSync(
          "python3",
          ["-c", ZIP_CORE, file, path.basename(file, ".zip")],
          { encoding: "utf8", timeout: 20000, maxBuffer: 8 * 1024 * 1024 },
        );
        if (read.error || read.status !== 0) {
          addIssue(
            `Cannot inspect archived handoff core: ${path.relative(cwd, file)}`,
          );
          continue;
        }
        text = read.stdout;
      } else text = fs.readFileSync(file, "utf8");
      bytes += Buffer.byteLength(text);
      if (
        Buffer.byteLength(text) > 8 * 1024 * 1024 ||
        bytes > 128 * 1024 * 1024
      ) {
        addIssue(`Evidence byte limit exceeded: ${path.relative(cwd, file)}`);
        continue;
      }
      const source = path.relative(cwd, file);
      const documentFile = file.endsWith(".zip")
        ? path.join(
            path.dirname(file),
            path.basename(file, ".zip"),
            "session-handoff.json",
          )
        : file;
      const task = file.includes(`${path.sep}tasks${path.sep}`)
        ? file.slice(0, file.indexOf(`${path.sep}tasks${path.sep}`) + 6)
        : cwd;
      const resolveTarget = (value: string): string | undefined => {
        const raw = value.replace(/#[^#]*$/, "");
        const paths = [
          path.resolve(path.dirname(documentFile), raw),
          path.resolve(cwd, raw),
        ];
        // Task-relative fields also occur in JSON nested under the task folder.
        let parent = path.dirname(file);
        while (parent !== task && parent.startsWith(task + path.sep)) {
          paths.push(path.resolve(parent, raw));
          parent = path.dirname(parent);
        }
        return paths.find((candidate) => candidates.has(candidate));
      };
      const record = (target: string, role: string, hard: boolean): void => {
        if (target === file) return;
        const list = hard ? result.protected : result.mentions;
        if (
          !list.some(
            (item) =>
              item.source === source &&
              item.target === target &&
              item.role === role,
          )
        )
          list.push({ source, target, role });
      };
      const visit = (value: unknown, role = "mention", depth = 0): void => {
        if (depth > 64) throw new Error("Evidence nesting limit exceeded");
        if (typeof value === "string") {
          const target = resolveTarget(value);
          if (target) record(target, role, role !== "mention");
          return;
        }
        if (Array.isArray(value)) {
          for (const item of value) visit(item, role, depth + 1);
        } else if (value && typeof value === "object") {
          const object = value as Record<string, unknown>;
          // A frozen plan locator alone does not make a settled session permanent.
          if (
            sessionId &&
            (object.sessionId === sessionId || object.session_id === sessionId)
          ) {
            const plan = "plan_hash" in object && "assignments" in object;
            record(
              `session:${sessionId}`,
              plan ? "plan-locator" : "result-or-control",
              !plan && (object.kind === "trellis_result" || role !== "mention"),
            );
            if (plan && Array.isArray(object.assignments)) {
              let taskRoot = path.dirname(file);
              while (
                !fs.existsSync(path.join(taskRoot, "task.json")) &&
                taskRoot.startsWith(cwd + path.sep)
              )
                taskRoot = path.dirname(taskRoot);
              if (
                taskRoot === cwd &&
                !fs.existsSync(path.join(taskRoot, "task.json"))
              ) {
                addIssue(
                  `Cannot locate the task for a matching plan: ${source}`,
                );
              } else
                for (const assignment of object.assignments as Record<
                  string,
                  unknown
                >[]) {
                  if (typeof assignment.brief_path !== "string") {
                    addIssue(`Invalid matching plan assignment: ${source}`);
                    continue;
                  }
                  const attempts = safePath(
                    taskRoot,
                    path.join(path.dirname(assignment.brief_path), "attempts"),
                  );
                  if (!fs.existsSync(attempts)) continue;
                  const entries = fs.readdirSync(attempts, {
                    withFileTypes: true,
                  });
                  if (entries.length > 256)
                    throw new Error(
                      "Attempt evidence inspection limit exceeded",
                    );
                  for (const entry of entries) {
                    if (entry.isSymbolicLink())
                      throw new Error("Redirected attempt evidence");
                    if (
                      entry.isDirectory() &&
                      ["report.json", "worklog.md", "provider-stderr.log"].some(
                        (name) =>
                          fs.existsSync(
                            safePath(attempts, path.join(entry.name, name)),
                          ),
                      )
                    )
                      record(
                        `session:${sessionId}`,
                        "retained-attempt-evidence",
                        true,
                      );
                  }
                }
            }
          }
          for (const [key, item] of Object.entries(object)) {
            const evidence =
              /^(artifact|artifact_refs|evidence|evidence_refs|references|context|file|worklogPath|locator|result_ref|result_path|approval_ref|restore|recovery|setup_ref)$/.test(
                key,
              );
            // Embedded rollout history is not current control or semantic evidence.
            if (
              /^(history|rollout|records|messages|conversation)$/.test(key) &&
              file.includes(`${path.sep}session-handoffs${path.sep}`)
            )
              continue;
            visit(
              item,
              evidence
                ? key
                : object.kind === "trellis_result"
                  ? "result"
                  : role,
              depth + 1,
            );
          }
        }
      };
      if (/\.(jsonl?|zip)$/.test(file)) {
        try {
          const values: unknown[] = file.endsWith(".jsonl")
            ? text
                .split("\n")
                .filter((line) => line.trim())
                .map((line) => JSON.parse(line) as unknown)
            : [JSON.parse(text) as unknown];
          for (const value of values) visit(value);
        } catch {
          const affected =
            [...candidates].some(
              (target) =>
                text.includes(target) ||
                text.includes(path.relative(cwd, target)),
            ) ||
            (!!sessionId && text.includes(sessionId));
          if (affected)
            addIssue(
              `Cannot interpret a matching evidence document: ${source}`,
            );
        }
      } else {
        for (const match of text.matchAll(/\[([^\]]+)\]\(<?([^\s)>]+)>?\)/g)) {
          const target = resolveTarget(match[2]);
          if (target)
            record(
              target,
              "document-link",
              /证据|报告|恢复|evidence|report|result|restore/i.test(match[1]),
            );
        }
      }
      for (const target of candidates)
        if (text.includes(target) || text.includes(path.relative(cwd, target)))
          record(target, "text-mention", false);
    }
  } catch (error) {
    addIssue(error instanceof Error ? error.message : String(error));
  }
  return result;
}

export function evidenceDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
