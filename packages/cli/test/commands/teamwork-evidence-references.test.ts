import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, expect, it } from "vitest";
import { inspectEvidenceReferences } from "../../src/commands/teamwork/evidence-references.js";

let root: string;
let task: string;
let report: string;
let worklog: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-evidence-"));
  task = path.join(root, ".trellis/tasks/completed/2026-11/11-12-evidence");
  fs.mkdirSync(task, { recursive: true });
  report = path.join(task, "teammates/batch/work/attempts/attempt/report.json");
  worklog = path.join(path.dirname(report), "worklog.md");
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.writeFileSync(report, "{}");
  fs.writeFileSync(worklog, "work log");
  fs.writeFileSync(
    path.join(task, "task.json"),
    JSON.stringify({ status: "completed" }),
  );
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it("protects persisted result artifacts and worklogs while retaining weak inventory mentions separately", () => {
  fs.writeFileSync(
    path.join(task, "result.json"),
    JSON.stringify({
      kind: "trellis_result",
      association: { sessionId: "session" },
      reports: [
        {
          artifact: { path: report, sha256: "a".repeat(64) },
          worklogPath: worklog,
        },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(root, "inventory.md"),
    `Files: ${report}, ${worklog}`,
  );
  const checked = inspectEvidenceReferences(root, [report, worklog], "session");
  expect(checked.complete).toBe(true);
  expect(new Set(checked.protected.map((item) => item.target))).toEqual(
    new Set([report, worklog, "session:session"]),
  );
  expect(checked.mentions.some((item) => item.source === "inventory.md")).toBe(
    true,
  );
});

it("resolves task-relative accepted evidence from nested documents and ignores self references", () => {
  fs.writeFileSync(
    path.join(task, "task.json"),
    JSON.stringify({
      meta: {
        phases: { accepted: { artifact_refs: [path.relative(task, report)] } },
      },
    }),
  );
  fs.writeFileSync(
    report,
    JSON.stringify({
      artifact: { path: report },
      worklogPath: path.relative(task, worklog),
    }),
  );
  const checked = inspectEvidenceReferences(root, [report, worklog]);
  expect(checked.protected).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ target: report, role: "artifact_refs" }),
      expect.objectContaining({ target: worklog, role: "worklogPath" }),
    ]),
  );
  expect(
    checked.protected.some(
      (item) => item.target === report && item.source.endsWith("report.json"),
    ),
  ).toBe(false);
});

it("distinguishes evidence links from inventory links", () => {
  fs.writeFileSync(path.join(root, "inventory.md"), `[inventory](${report})\n`);
  expect(inspectEvidenceReferences(root, [report]).protected).toHaveLength(0);
  fs.writeFileSync(path.join(root, "accepted.md"), `[报告证据](${report})\n`);
  expect(inspectEvidenceReferences(root, [report]).protected).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ role: "document-link", target: report }),
    ]),
  );
});

it("retains session events while native attempt evidence still needs replay, without making a plan locator permanent", () => {
  fs.writeFileSync(
    path.join(task, "plan.json"),
    JSON.stringify({
      schema_version: 2,
      session_id: "session",
      batch_id: "batch",
      plan_hash: "a".repeat(64),
      assignments: [{ brief_path: "teammates/batch/work/brief.json" }],
    }),
  );
  expect(inspectEvidenceReferences(root, [], "session").protected).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ role: "retained-attempt-evidence" }),
    ]),
  );
  fs.unlinkSync(report);
  fs.unlinkSync(worklog);
  const checked = inspectEvidenceReferences(root, [], "session");
  expect(checked.protected).toHaveLength(0);
  expect(checked.mentions).toEqual(
    expect.arrayContaining([expect.objectContaining({ role: "plan-locator" })]),
  );
});

it("preserves a matching malformed dependency and reports redirected evidence scope", () => {
  fs.writeFileSync(path.join(task, "broken.json"), `{ "artifact": "${report}"`);
  expect(inspectEvidenceReferences(root, [report]).complete).toBe(false);
  fs.unlinkSync(path.join(task, "broken.json"));
  fs.symlinkSync(task, path.join(root, "docs"), "dir");
  const checked = inspectEvidenceReferences(root, [report]);
  expect(checked.complete).toBe(false);
  expect(checked.issues.join(" ")).toMatch(/Redirected|symlink/);
});

it("protects evidence referenced by an archived handoff and preserves an unreadable archive", () => {
  const directory = path.join(root, ".trellis/session-handoffs");
  fs.mkdirSync(directory, { recursive: true });
  const identifier = "20261112T034906500836Z";
  const archive = path.join(directory, `${identifier}.zip`);
  execFileSync("python3", [
    "-c",
    `import hashlib,json,sys,zipfile
raw=json.dumps({"references":[sys.argv[3]]}).encode()
manifest={"storage_version":1,"handoff_id":sys.argv[2],"members":{"session-handoff.json":{"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()}}}
with zipfile.ZipFile(sys.argv[1],"w") as archive:
    archive.writestr("session-handoff.json",raw)
    archive.writestr("storage-manifest.json",json.dumps(manifest))
`,
    archive,
    identifier,
    report,
  ]);
  const checked = inspectEvidenceReferences(root, [report]);
  expect(checked.complete).toBe(true);
  expect(checked.protected).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        target: report,
        source: path.relative(root, archive),
      }),
    ]),
  );
  fs.writeFileSync(archive, "damaged archive");
  expect(inspectEvidenceReferences(root, [report]).complete).toBe(false);
});
