/**
 * Integration tests for `subnode_artifact.py`.
 *
 * The helper runs against a fresh project stamped from the shipped Trellis
 * Python templates. These tests exercise the public CLI and its filesystem
 * containment checks rather than importing implementation functions.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  return spawnSync(
    "python3",
    [".trellis/scripts/subnode_artifact.py", ...args],
    {
      cwd: repo,
      encoding: "utf-8",
    },
  );
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
  const reportPath = path.join(dir, "report.json");
  fs.writeFileSync(
    reportPath,
    JSON.stringify({
      schema_version: 2,
      task_id: brief.task_id,
      work_id: brief.work_id,
      subnode_id: brief.subnode_id,
      role_id: brief.role_id,
      status: "complete",
      scope: brief.scope,
      lens: brief.lens,
      scope_assessment: brief.scope.map((item: string) => ({
        scope: item,
        status: "covered",
        conclusion: "The assigned scope was covered.",
        evidence_ids: [evidenceId],
      })),
      evidence: [
        {
          id: evidenceId,
          locator,
          summary:
            "Directly observed source supporting the reported conclusion.",
        },
      ],
      findings: [
        {
          id: `finding-${evidenceId}`,
          conclusion: "The evidence is independently reviewable.",
          evidence_ids: [evidenceId],
        },
      ],
      uncertainties: [],
      corrections: [],
    }) + "\n",
  );
  fs.appendFileSync(
    path.join(dir, "worklog.md"),
    `\n<!-- trellis-checkpoint: ${JSON.stringify({
      id: "checkpoint-1",
      covered_scope: brief.scope,
      evidence_ids: [evidenceId],
      conclusion_or_blocker: "The assigned scope is complete.",
      unknowns: [],
      safe_resume_point: "No further work is required for this scope.",
    })} -->\n`,
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
    const brief = JSON.parse(
      fs.readFileSync(path.join(dir, "brief.json"), "utf-8"),
    );
    expect(brief).toMatchObject({
      schema_version: 2,
      task_id: "task-a",
      work_id: "dependency-audit",
      subnode_id: "primary",
      role_id: "subnode",
      report_path:
        ".trellis/tasks/task-a/subnodes/dependency-audit/primary/report.json",
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

    const legacy = JSON.parse(fs.readFileSync(report, "utf-8"));
    legacy.schema_version = 1;
    fs.writeFileSync(report, JSON.stringify(legacy) + "\n");
    const rejectedLegacy = run(tmp, "validate", "--report", report);
    expect(rejectedLegacy.status).toBe(1);
    expect(rejectedLegacy.stderr).toContain("schema_version must be 2");
  });

  it("binds a worker handle and creates one coordinator disposition", () => {
    const mismatch = run(
      tmp,
      "init",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "coordinator-decision",
      "--subnode-id",
      "primary",
      "--draft",
      writeDraft(tmp, "mismatch.json", {
        channel_ref: {
          name: "subnode-task-a",
          scope: "project",
          worker_handle: "other-worker",
        },
      }),
    );
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain("worker_handle must match");

    const init = run(
      tmp,
      "init",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "coordinator-decision",
      "--subnode-id",
      "primary",
      "--draft",
      writeDraft(tmp, "decision.json"),
    );
    expect(init.status, init.stderr).toBe(0);
    const report = writeCompleteReport(
      tmp,
      "coordinator-decision",
      "primary",
      "source",
      "README.md",
    );

    const missingChecks = run(
      tmp,
      "disposition",
      "--report",
      report,
      "--outcome",
      "accepted",
      "--terminal-lifecycle",
      "done",
      "--terminal-seq",
      "17",
      "--terminal-at",
      "2026-09-14T03:00:00Z",
      "--check",
      "report_validation",
      "--reason",
      "The coordinator inspected the report.",
    );
    expect(missingChecks.status).toBe(1);
    expect(missingChecks.stderr).toContain("disposition.checks is missing");

    const disposition = run(
      tmp,
      "disposition",
      "--report",
      report,
      "--outcome",
      "accepted",
      "--terminal-lifecycle",
      "done",
      "--terminal-seq",
      "17",
      "--terminal-at",
      "2026-09-14T03:00:00Z",
      "--check",
      "report_validation",
      "--check",
      "source_recheck",
      "--check",
      "protected_target_check",
      "--reason",
      "The coordinator independently rechecked the evidence and target state.",
    );
    expect(disposition.status, disposition.stderr).toBe(0);
    const dispositionPath = path.join(
      artifactDir(tmp, "coordinator-decision", "primary"),
      "disposition.json",
    );
    expect(JSON.parse(fs.readFileSync(dispositionPath, "utf-8"))).toMatchObject(
      {
        outcome: "accepted",
        report_status: "complete",
        terminal: { lifecycle: "done", seq: 17 },
        checks: [
          "report_validation",
          "source_recheck",
          "protected_target_check",
        ],
      },
    );

    const duplicate = run(
      tmp,
      "disposition",
      "--report",
      report,
      "--outcome",
      "accepted",
      "--terminal-lifecycle",
      "done",
      "--terminal-seq",
      "17",
      "--terminal-at",
      "2026-09-14T03:00:00Z",
      "--check",
      "report_validation",
      "--check",
      "source_recheck",
      "--check",
      "protected_target_check",
      "--reason",
      "Repeated decision.",
    );
    expect(duplicate.status).toBe(1);
    expect(duplicate.stderr).toContain("disposition already exists");
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
      writeDraft(tmp, "planning-draft.json", {
        channel_ref: {
          name: "subnode-task-a",
          scope: "project",
          worker_handle: "independent-design",
        },
      }),
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

  it("allows relation-free briefs and early terminal reports", () => {
    const init = run(
      tmp,
      "init",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "early-error",
      "--subnode-id",
      "primary",
      "--draft",
      writeDraft(tmp, "early-error.json"),
    );
    expect(init.status, init.stderr).toBe(0);

    const dir = artifactDir(tmp, "early-error", "primary");
    const brief = JSON.parse(
      fs.readFileSync(path.join(dir, "brief.json"), "utf-8"),
    );
    expect(brief).not.toHaveProperty("retry_of");
    expect(brief).not.toHaveProperty("counter_of");

    const reportPath = path.join(dir, "report.json");
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        schema_version: 2,
        task_id: brief.task_id,
        work_id: brief.work_id,
        subnode_id: brief.subnode_id,
        role_id: brief.role_id,
        status: "error",
        scope: brief.scope,
        lens: brief.lens,
        scope_assessment: brief.scope.map((item: string) => ({
          scope: item,
          status: "not-started",
          conclusion: "The worker stopped before this scope was inspected.",
          evidence_ids: [],
        })),
        evidence: [],
        findings: [],
        uncertainties: [],
        corrections: [],
        completed_scope: [],
        blocker: "The worker failed before inspecting the assigned scope.",
      }) + "\n",
    );
    const reviewConcern = run(tmp, "validate", "--report", reportPath);
    expect(reviewConcern.status, reviewConcern.stderr).toBe(0);
    expect(reviewConcern.stdout).toContain('"status": "review_concern"');
    expect(reviewConcern.stdout).toContain("missing_worklog_checkpoint");

    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    delete report.completed_scope;
    fs.writeFileSync(reportPath, JSON.stringify(report) + "\n");
    const missingScope = run(tmp, "validate", "--report", reportPath);
    expect(missingScope.status).toBe(1);
    expect(missingScope.stderr).toContain("report.completed_scope");
  });

  it("permits a manual retry only when its prior sibling brief exists", () => {
    const primary = run(
      tmp,
      "init",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "retry-audit",
      "--subnode-id",
      "primary",
      "--draft",
      writeDraft(tmp, "retry-primary.json"),
    );
    expect(primary.status, primary.stderr).toBe(0);

    const retry = run(
      tmp,
      "init",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "retry-audit",
      "--subnode-id",
      "retry-1",
      "--draft",
      writeDraft(tmp, "retry-1.json", {
        retry_of: "primary",
        channel_ref: {
          name: "subnode-task-a",
          scope: "project",
          worker_handle: "retry-1",
        },
      }),
    );
    expect(retry.status, retry.stderr).toBe(0);

    const retryBrief = JSON.parse(
      fs.readFileSync(
        path.join(artifactDir(tmp, "retry-audit", "retry-1"), "brief.json"),
        "utf-8",
      ),
    );
    expect(retryBrief.retry_of).toBe("primary");
    const reportPath = writeCompleteReport(
      tmp,
      "retry-audit",
      "retry-1",
      "retry-source",
      "README.md",
    );
    const validate = run(tmp, "validate", "--report", reportPath);
    expect(validate.status, validate.stderr).toBe(0);

    const missing = run(
      tmp,
      "init",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "missing-retry",
      "--subnode-id",
      "retry-1",
      "--draft",
      writeDraft(tmp, "missing-retry-target.json", {
        retry_of: "primary",
        channel_ref: {
          name: "subnode-task-a",
          scope: "project",
          worker_handle: "retry-1",
        },
      }),
    );
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("existing subnode brief");
  });

  it("writes and validates a FIFO queue, one claim per item, and one abandonment", () => {
    for (const [subnodeId, draftName] of [
      ["primary", "queue-primary.json"],
      ["secondary", "queue-secondary.json"],
    ] as const) {
      const init = run(
        tmp,
        "init",
        "--task",
        ".trellis/tasks/task-a",
        "--work-id",
        "queue-audit",
        "--subnode-id",
        subnodeId,
        "--draft",
        writeDraft(tmp, draftName, {
          channel_ref: {
            name: "subnode-task-a",
            scope: "project",
            worker_handle: subnodeId,
          },
        }),
      );
      expect(init.status, init.stderr).toBe(0);
    }

    const briefPaths = ["primary", "secondary"].map((subnodeId) =>
      path.join(artifactDir(tmp, "queue-audit", subnodeId), "brief.json"),
    );
    const queue = run(
      tmp,
      "queue",
      "init",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "queue-audit",
      "--channel-name",
      "subnode-task-a",
      "--channel-scope",
      "project",
      "--brief",
      briefPaths[0],
      "--brief",
      briefPaths[1],
    );
    expect(queue.status, queue.stderr).toBe(0);

    const valid = run(
      tmp,
      "queue",
      "validate",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "queue-audit",
    );
    expect(valid.status, valid.stderr).toBe(0);
    expect(JSON.parse(valid.stdout)).toMatchObject({
      status: "valid",
      item_count: 2,
    });

    const primaryBrief = briefPaths[0];
    const originalPrimary = fs.readFileSync(primaryBrief, "utf-8");
    fs.writeFileSync(primaryBrief, `${originalPrimary}\n`);
    const tampered = run(
      tmp,
      "queue",
      "validate",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "queue-audit",
    );
    expect(tampered.status).toBe(1);
    expect(tampered.stderr).toContain("brief digest does not match");
    fs.writeFileSync(primaryBrief, originalPrimary);

    const claim = run(
      tmp,
      "queue",
      "claim",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "queue-audit",
      "--subnode-id",
      "primary",
    );
    expect(claim.status, claim.stderr).toBe(0);
    const duplicateClaim = run(
      tmp,
      "queue",
      "claim",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "queue-audit",
      "--subnode-id",
      "primary",
    );
    expect(duplicateClaim.status).toBe(1);
    expect(duplicateClaim.stderr).toContain("already exists");

    const incompleteAbandon = run(
      tmp,
      "queue",
      "abandon",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "queue-audit",
      "--reason",
      "Incomplete accounting should be rejected.",
      "--dispatched",
      "primary",
    );
    expect(incompleteAbandon.status).toBe(1);
    expect(incompleteAbandon.stderr).toContain("exactly match");

    const abandon = run(
      tmp,
      "queue",
      "abandon",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "queue-audit",
      "--reason",
      "The coordinator stopped after the first dispatch attempt.",
      "--dispatched",
      "primary",
      "--pending",
      "secondary",
    );
    expect(abandon.status, abandon.stderr).toBe(0);

    const mismatchedAbandon = run(
      tmp,
      "queue",
      "abandon",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "queue-audit",
      "--reason",
      "Claim state must determine the recorded ranges.",
      "--dispatched",
      "secondary",
      "--pending",
      "primary",
    );
    expect(mismatchedAbandon.status).toBe(1);
    expect(mismatchedAbandon.stderr).toContain("exactly match");

    const blockedClaim = run(
      tmp,
      "queue",
      "claim",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "queue-audit",
      "--subnode-id",
      "secondary",
    );
    expect(blockedClaim.status).toBe(1);
    expect(blockedClaim.stderr).toContain("abandoned");

    const abandoned = run(
      tmp,
      "queue",
      "validate",
      "--task",
      ".trellis/tasks/task-a",
      "--work-id",
      "queue-audit",
    );
    expect(JSON.parse(abandoned.stdout)).toMatchObject({ status: "abandoned" });
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

  it.skipIf(process.platform === "win32")(
    "rejects a symlinked artifact directory",
    () => {
      const outside = path.join(tmp, "outside");
      fs.mkdirSync(outside);
      const subnodes = path.join(
        tmp,
        ".trellis",
        "tasks",
        "task-a",
        "subnodes",
      );
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
    },
  );

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
