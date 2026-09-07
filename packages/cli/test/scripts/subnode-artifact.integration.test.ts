/**
 * Integration tests for `subnode_artifact.py`.
 *
 * The helper runs against a fresh project stamped from the shipped Trellis
 * Python templates. These tests exercise the public CLI and its filesystem
 * containment checks rather than importing implementation functions.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEMPLATE_SCRIPTS = path.resolve(
  __dirname,
  "../../src/templates/trellis/scripts",
);

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function setupRepo(tmp: string): void {
  fs.mkdirSync(path.join(tmp, ".trellis", "scripts"), { recursive: true });
  fs.cpSync(TEMPLATE_SCRIPTS, path.join(tmp, ".trellis", "scripts"), {
    recursive: true,
  });
  const taskDir = path.join(tmp, ".trellis", "tasks", "task-a");
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(
    path.join(taskDir, "task.json"),
    JSON.stringify({
      id: "task-a",
      name: "task-a",
      title: "Task A",
      status: "in_progress",
      assignee: "tester",
      priority: "P2",
      children: [],
      subtasks: [],
      relatedFiles: [],
      meta: {},
    }) + "\n",
  );
}

function run(repo: string, ...args: string[]) {
  return spawnSync("python3", [".trellis/scripts/subnode_artifact.py", ...args], {
    cwd: repo,
    encoding: "utf-8",
  });
}

function writeDraft(
  repo: string,
  fileName: string,
  overrides: Record<string, unknown> = {},
): string {
  const draft = {
    question: "Does the dependency evidence support this change?",
    independence_reason: "The coordinator needs an independent evidence trail.",
    scope: ["inspect dependency metadata"],
    protected_targets: ["packages/cli/src"],
    lens: "dependency evidence",
    evidence_method: "inspect pinned metadata and source references",
    source_snapshot: [
      {
        locator: "packages/cli/package.json",
        revision_or_digest: "abc123",
        observed_at: "2026-09-07T12:00:00Z",
      },
    ],
    dependencies: [],
    stop_conditions: ["Evidence is sufficient to support or reject the claim."],
    deadline: "2026-09-07T13:00:00Z",
    channel_ref: {
      name: "subnode-task-a",
      scope: "project",
      worker_handle: "primary",
    },
    retry_of: null,
    counter_of: null,
    ...overrides,
  };
  const output = path.join(repo, fileName);
  fs.writeFileSync(output, JSON.stringify(draft) + "\n");
  return output;
}

function artifactDir(repo: string, workId: string, subnodeId: string): string {
  return path.join(
    repo,
    ".trellis",
    "tasks",
    "task-a",
    "subnodes",
    workId,
    subnodeId,
  );
}

function writeCompleteReport(
  repo: string,
  workId: string,
  subnodeId: string,
  evidenceId: string,
  locator: string,
): string {
  const dir = artifactDir(repo, workId, subnodeId);
  const briefPath = path.join(dir, "brief.json");
  const brief = JSON.parse(fs.readFileSync(briefPath, "utf-8"));
  const briefDigest = createHash("sha256")
    .update(fs.readFileSync(briefPath))
    .digest("hex");
  const reportPath = path.join(dir, "report.json");
  fs.writeFileSync(
    reportPath,
    JSON.stringify({
      schema_version: 1,
      task_id: brief.task_id,
      work_id: brief.work_id,
      subnode_id: brief.subnode_id,
      role_id: brief.role_id,
      brief_digest: briefDigest,
      status: "complete",
      scope: brief.scope,
      lens: brief.lens,
      evidence: [
        {
          id: evidenceId,
          locator,
          summary: "Directly observed source supporting the reported conclusion.",
        },
      ],
      findings: ["The evidence is independently reviewable."],
      uncertainties: [],
      corrections: [],
    }) + "\n",
  );
  return reportPath;
}

describe.skipIf(!hasPython())("subnode_artifact.py", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-subnode-test-"));
    setupRepo(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("creates immutable task-owned artifacts and validates a complete report", () => {
    const draft = writeDraft(tmp, "primary-draft.json");
    const init = run(
      tmp,
      "init",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "dependency-audit",
      "--subnode-id",
      "primary",
      "--draft",
      draft,
    );
    expect(init.status, init.stderr).toBe(0);

    const dir = artifactDir(tmp, "dependency-audit", "primary");
    const brief = JSON.parse(fs.readFileSync(path.join(dir, "brief.json"), "utf-8"));
    expect(brief).toMatchObject({
      schema_version: 1,
      task_id: "task-a",
      work_id: "dependency-audit",
      subnode_id: "primary",
      role_id: "subnode",
      retry_of: null,
      counter_of: null,
      report_path: ".trellis/tasks/task-a/subnodes/dependency-audit/primary/report.json",
    });
    expect(fs.readFileSync(path.join(dir, "worklog.md"), "utf-8")).toContain(
      "# Subnode Worklog",
    );

    const duplicate = run(
      tmp,
      "init",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "dependency-audit",
      "--subnode-id",
      "primary",
      "--draft",
      draft,
    );
    expect(duplicate.status).toBe(1);
    expect(duplicate.stderr).toContain("already exist");

    const report = writeCompleteReport(
      tmp,
      "dependency-audit",
      "primary",
      "metadata",
      "packages/cli/package.json",
    );
    const validate = run(tmp, "validate", "--report", report);
    expect(validate.status, validate.stderr).toBe(0);
    expect(validate.stdout).toContain("pending-review");
  });

  it("permits bounded planning evidence before task activation", () => {
    const taskPath = path.join(tmp, ".trellis", "tasks", "task-a", "task.json");
    const task = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
    task.status = "planning";
    fs.writeFileSync(taskPath, JSON.stringify(task) + "\n");

    const init = run(
      tmp,
      "init",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "design-evidence",
      "--subnode-id",
      "independent-design",
      "--draft",
      writeDraft(tmp, "planning-draft.json"),
    );
    expect(init.status, init.stderr).toBe(0);
    expect(
      fs.existsSync(
        path.join(
          artifactDir(tmp, "design-evidence", "independent-design"),
          "brief.json",
        ),
      ),
    ).toBe(true);
  });

  it("requires explicit retry and counter relations in every brief", () => {
    const missingRetry = writeDraft(tmp, "missing-retry.json");
    const retryDraft = JSON.parse(fs.readFileSync(missingRetry, "utf-8"));
    delete retryDraft.retry_of;
    fs.writeFileSync(missingRetry, JSON.stringify(retryDraft) + "\n");

    const retryResult = run(
      tmp,
      "init",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "relation-check",
      "--subnode-id",
      "missing-retry",
      "--draft",
      missingRetry,
    );
    expect(retryResult.status).toBe(1);
    expect(retryResult.stderr).toContain("brief.retry_of must be present");

    const missingCounter = writeDraft(tmp, "missing-counter.json");
    const counterDraft = JSON.parse(fs.readFileSync(missingCounter, "utf-8"));
    delete counterDraft.counter_of;
    fs.writeFileSync(missingCounter, JSON.stringify(counterDraft) + "\n");

    const counterResult = run(
      tmp,
      "init",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "relation-check",
      "--subnode-id",
      "missing-counter",
      "--draft",
      missingCounter,
    );
    expect(counterResult.status).toBe(1);
    expect(counterResult.stderr).toContain("brief.counter_of must be present");
    expect(fs.existsSync(artifactDir(tmp, "relation-check", "missing-retry"))).toBe(
      false,
    );
    expect(fs.existsSync(artifactDir(tmp, "relation-check", "missing-counter"))).toBe(
      false,
    );
  });

  it("rejects traversal and a report that pretends to be an accepted disposition", () => {
    const draft = writeDraft(tmp, "draft.json");
    const traversal = run(
      tmp,
      "init",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "../escape",
      "--subnode-id",
      "primary",
      "--draft",
      draft,
    );
    expect(traversal.status).toBe(1);
    expect(fs.existsSync(path.join(tmp, "escape"))).toBe(false);

    const init = run(
      tmp,
      "init",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "audit",
      "--subnode-id",
      "primary",
      "--draft",
      draft,
    );
    expect(init.status, init.stderr).toBe(0);
    const reportPath = writeCompleteReport(
      tmp,
      "audit",
      "primary",
      "source",
      "README.md",
    );
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    report.status = "accepted";
    fs.writeFileSync(reportPath, JSON.stringify(report) + "\n");
    const validate = run(tmp, "validate", "--report", reportPath);
    expect(validate.status).toBe(1);
    expect(validate.stderr).toContain("report.status");
  });

  it.skipIf(process.platform === "win32")("rejects a symlinked artifact directory", () => {
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(outside);
    const subnodes = path.join(tmp, ".trellis", "tasks", "task-a", "subnodes");
    fs.symlinkSync(outside, subnodes, "dir");
    const draft = writeDraft(tmp, "draft.json");
    const init = run(
      tmp,
      "init",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "audit",
      "--subnode-id",
      "primary",
      "--draft",
      draft,
    );
    expect(init.status).toBe(1);
    expect(init.stderr).toContain("symlink");
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("requires intentional independent evidence for counterwork", () => {
    const primaryDraft = writeDraft(tmp, "primary.json");
    const primary = run(
      tmp,
      "init",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "audit",
      "--subnode-id",
      "primary",
      "--draft",
      primaryDraft,
    );
    expect(primary.status, primary.stderr).toBe(0);
    const counterDraft = writeDraft(tmp, "counter.json", {
      lens: "contrary evidence",
      counter_of: "primary",
      channel_ref: {
        name: "subnode-task-a",
        scope: "project",
        worker_handle: "counter",
      },
    });
    const counter = run(
      tmp,
      "init",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "audit",
      "--subnode-id",
      "counter",
      "--draft",
      counterDraft,
    );
    expect(counter.status, counter.stderr).toBe(0);
    writeCompleteReport(tmp, "audit", "primary", "primary-source", "README.md");
    writeCompleteReport(tmp, "audit", "counter", "counter-source", "LICENSE");
    const validate = run(
      tmp,
      "validate-counter",
      "--primary",
      artifactDir(tmp, "audit", "primary"),
      "--counter",
      artifactDir(tmp, "audit", "counter"),
    );
    expect(validate.status, validate.stderr).toBe(0);
    expect(validate.stdout).toContain("independent counter reports");
  });
});
