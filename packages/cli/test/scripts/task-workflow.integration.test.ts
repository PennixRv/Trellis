import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEMPLATE_SCRIPTS = path.resolve(
  __dirname,
  "../../src/templates/trellis/scripts",
);
const TASK = "10-31-phase-workflow-test";
const PHASE_1 = "goal_exploration_and_requirements";
const PHASE_2 = "decision_space_construction_and_merging";
const PHASE_3 = "solution_design_and_convergence";
const PHASE_4 = "task_implementation";
const PHASE_5 = "delivery_review_and_closeout";

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function setupRepo(root: string): void {
  fs.writeFileSync(path.join(root, ".gitignore"), ".trellis/.runtime/\n");
  const scriptsDir = path.join(root, ".trellis", "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.cpSync(TEMPLATE_SCRIPTS, scriptsDir, { recursive: true });
  const taskDir = path.join(root, ".trellis", "tasks", TASK);
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, "prd.md"), "# Requirements\n");
  fs.writeFileSync(
    path.join(taskDir, "task.json"),
    JSON.stringify({
      id: TASK,
      name: TASK,
      title: "Phase workflow test",
      description: "Integration fixture",
      status: "in_progress",
      dev_type: null,
      scope: null,
      package: null,
      priority: "P2",
      creator: "tester",
      assignee: "tester",
      createdAt: "2026-10-31",
      completedAt: null,
      branch: null,
      base_branch: null,
      worktree_path: null,
      commit: null,
      pr_url: null,
      subtasks: [],
      children: [],
      parent: null,
      relatedFiles: [],
      notes: "",
      meta: {},
    }) + "\n",
  );
}

function runTask(root: string, ...args: string[]) {
  return spawnSync("python3", [".trellis/scripts/task.py", ...args], {
    cwd: root,
    encoding: "utf-8",
  });
}

function runTaskAs(root: string, sessionId: string, ...args: string[]) {
  return spawnSync("python3", [".trellis/scripts/task.py", ...args], {
    cwd: root,
    encoding: "utf-8",
    env: { ...process.env, TRELLIS_CONTEXT_ID: sessionId },
  });
}

function runOkAs(root: string, sessionId: string, ...args: string[]): string {
  const result = runTaskAs(root, sessionId, ...args);
  if (result.status !== 0) {
    throw new Error(`task.py ${args.join(" ")} failed: ${result.stdout} ${result.stderr}`);
  }
  return result.stdout;
}

interface TaskWorkflowState {
  task_route_revision: string;
  current_phase_id: string;
  phases: Record<
    string,
    {
      artifact_revision?: string;
      status?: string;
      outcome_kind?: string;
      acceptance?: { user_confirmation_ref?: string };
    }
  >;
  skip_records: Record<string, { reason: string }>;
}

function readState(root: string): TaskWorkflowState {
  const task = JSON.parse(
    fs.readFileSync(
      path.join(root, ".trellis", "tasks", TASK, "task.json"),
      "utf-8",
    ),
  ) as { meta: { task_workflow: TaskWorkflowState } };
  return task.meta.task_workflow;
}

function runOk(root: string, ...args: string[]): string {
  const result = runTask(root, ...args);
  if (result.status !== 0) {
    throw new Error(`task.py ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function setArtifact(root: string, phase: string): string {
  const output = runOk(
    root,
    "phase",
    "artifact",
    TASK,
    "--expected-route-revision",
    readState(root).task_route_revision,
    "--artifact-ref",
    "prd.md",
  );
  const revision = JSON.parse(output).artifact_revision as string;
  expect(readState(root).phases[phase].artifact_revision).toBe(revision);
  return revision;
}

function accept(root: string, phase: string, outcome: string, options: string[] = []): void {
  const state = readState(root);
  const revision = setArtifact(root, phase);
  runOk(
    root,
    "phase",
    "accept",
    TASK,
    "--expected-route-revision",
    state.task_route_revision,
    "--artifact-revision",
    revision,
    "--result-ref",
    "prd.md",
    "--outcome-kind",
    outcome,
    "--evidence-ref",
    "prd.md",
    ...options,
  );
}

describe.skipIf(!hasPython())("task.py phase workflow", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-task-phase-"));
    setupRepo(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("requires phase 1 confirmation, rejects stale routes, and completes an authorized delivery", () => {
    runOk(
      root,
      "phase",
      "init",
      TASK,
      "--task-kind",
      "combined",
      "--complexity",
      "standard",
      "--project-context",
      "existing",
      "--phase-ids",
      [PHASE_1, PHASE_2, PHASE_3, PHASE_4, PHASE_5].join(","),
    );
    const phase1Revision = setArtifact(root, PHASE_1);
    const wrongPhase1Result = runTask(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "1",
      "--artifact-revision",
      phase1Revision,
      "--result-ref",
      "prd.md",
      "--outcome-kind",
      "needs_user_input",
      "--evidence-ref",
      "prd.md",
      "--user-confirmation-ref",
      "user-message:requirements-approved",
    );
    expect(wrongPhase1Result.status).toBe(1);
    expect(wrongPhase1Result.stderr).toContain("phase_result=accepted");
    const unconfirmed = runTask(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "1",
      "--artifact-revision",
      phase1Revision,
      "--result-ref",
      "prd.md",
      "--outcome-kind",
      "accepted",
      "--evidence-ref",
      "prd.md",
    );
    expect(unconfirmed.status).toBe(1);
    expect(unconfirmed.stderr).toContain("TASK_PHASE_USER_CONFIRMATION_REQUIRED");
    runOk(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "1",
      "--artifact-revision",
      phase1Revision,
      "--result-ref",
      "prd.md",
      "--outcome-kind",
      "accepted",
      "--evidence-ref",
      "prd.md",
      "--user-confirmation-ref",
      "user-message:requirements-approved",
    );

    runOk(
      root,
      "phase",
      "route",
      TASK,
      "--expected-route-revision",
      "1",
      "--phase-ids",
      [PHASE_1, PHASE_3, PHASE_4, PHASE_5].join(","),
      "--target-phase",
      PHASE_2,
      "--reason",
      "No unresolved alternatives or decision branches remain",
      "--evidence-ref",
      "prd.md",
    );
    expect(readState(root).skip_records[PHASE_2].reason).toMatch(/No unresolved/);
    const stale = runTask(
      root,
      "phase",
      "route",
      TASK,
      "--expected-route-revision",
      "1",
      "--phase-ids",
      [PHASE_1, PHASE_3, PHASE_4, PHASE_5].join(","),
      "--target-phase",
      PHASE_3,
      "--reason",
      "stale update",
      "--evidence-ref",
      "prd.md",
    );
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain("TASK_PHASE_STALE_ROUTE");

    accept(root, PHASE_3, "implementation_contract");
    runOk(
      root,
      "phase",
      "authorize",
      TASK,
      "--expected-route-revision",
      "2",
      "--contract-ref",
      "prd.md",
      "--approval-ref",
      "user-message:implementation-approved",
    );
    accept(root, PHASE_4, "implementation_complete");
    accept(root, PHASE_5, "delivery_ready", ["--closeout-disposition", "delivery_ready"]);

    const task = JSON.parse(
      fs.readFileSync(
        path.join(root, ".trellis", "tasks", TASK, "task.json"),
        "utf-8",
      ),
    );
    expect(task.status).toBe("in_progress");
    expect(task.meta.task_workflow.phases[PHASE_1].acceptance.user_confirmation_ref).toBe(
      "user-message:requirements-approved",
    );

    runOk(root, "complete", TASK);
    const completed = JSON.parse(
      fs.readFileSync(
        path.join(root, ".trellis", "tasks", TASK, "task.json"),
        "utf-8",
      ),
    );
    expect(completed.status).toBe("completed");
    expect(fs.existsSync(path.join(root, ".trellis", "tasks", "archive"))).toBe(false);
  });

  it("keeps a deferred phase 3 result at phase 3 until its trigger is resolved", () => {
    runOk(
      root,
      "phase",
      "init",
      TASK,
      "--task-kind",
      "analysis",
      "--complexity",
      "simple",
      "--project-context",
      "existing",
      "--phase-ids",
      [PHASE_1, PHASE_3, PHASE_5].join(","),
      "--route-reason",
      "Decision and design phases are not needed for this bounded review",
      "--route-evidence-ref",
      "prd.md",
    );
    const phase1Revision = setArtifact(root, PHASE_1);
    runOk(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "1",
      "--artifact-revision",
      phase1Revision,
      "--result-ref",
      "prd.md",
      "--outcome-kind",
      "accepted",
      "--evidence-ref",
      "prd.md",
      "--user-confirmation-ref",
      "user-message:requirements-approved",
    );
    const revision = setArtifact(root, PHASE_3);
    const prematureAccept = runTask(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "1",
      "--artifact-revision",
      revision,
      "--result-ref",
      "prd.md",
      "--outcome-kind",
      "deferred",
      "--evidence-ref",
      "prd.md",
    );
    expect(prematureAccept.status).toBe(1);
    expect(prematureAccept.stderr).toContain("phase 3 must remain active");
    runOk(
      root,
      "phase",
      "block",
      "10-31-phase-workflow-test",
      "--expected-route-revision",
      "1",
      "--reason",
      "Waiting for the deferred trigger",
      "--outcome-kind",
      "deferred",
      "--evidence-ref",
      "prd.md",
    );
    expect(readState(root).current_phase_id).toBe(PHASE_3);
    expect(readState(root).phases[PHASE_3].status).toBe("blocked");
    expect(readState(root).phases[PHASE_3].outcome_kind).toBe("deferred");
  });

  it("invalidates phase 1 confirmation when its bound artifact changes", () => {
    runOk(
      root,
      "phase",
      "init",
      TASK,
      "--task-kind",
      "analysis",
      "--complexity",
      "standard",
      "--project-context",
      "existing",
      "--route-reason",
      "Verify phase 1 artifact revision binding",
      "--route-evidence-ref",
      "prd.md",
      "--phase-ids",
      [PHASE_1, PHASE_2, PHASE_5].join(","),
    );
    const firstRevision = setArtifact(root, PHASE_1);
    runOk(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "1",
      "--artifact-revision",
      firstRevision,
      "--result-ref",
      "prd.md",
      "--outcome-kind",
      "accepted",
      "--evidence-ref",
      "prd.md",
      "--user-confirmation-ref",
      "user-message:requirements-v1",
    );
    fs.writeFileSync(path.join(root, ".trellis", "tasks", TASK, "prd.md"), "# Revised requirements\n");
    const stale = runTask(
      root,
      "phase",
      "artifact",
      TASK,
      "--expected-route-revision",
      "1",
      "--artifact-ref",
      "prd.md",
    );
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain("TASK_PHASE_STALE_ARTIFACT");

    runOk(
      root,
      "phase",
      "return",
      TASK,
      "--expected-route-revision",
      "1",
      "--target-phase",
      PHASE_1,
      "--reason",
      "The confirmed requirement artifact changed",
      "--evidence-ref",
      "prd.md",
    );
    const revisedRevision = setArtifact(root, PHASE_1);
    runOk(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "1",
      "--artifact-revision",
      revisedRevision,
      "--result-ref",
      "prd.md",
      "--outcome-kind",
      "accepted",
      "--evidence-ref",
      "prd.md",
      "--user-confirmation-ref",
      "user-message:requirements-v2",
    );
    expect(readState(root).phases[PHASE_1].acceptance.user_confirmation_ref).toBe(
      "user-message:requirements-v2",
    );
  });

  it("completes a no-go delivery after phase-5 review", () => {
    runOk(
      root,
      "phase",
      "init",
      TASK,
      "--task-kind",
      "analysis",
      "--complexity",
      "simple",
      "--project-context",
      "existing",
      "--phase-ids",
      [PHASE_1, PHASE_5].join(","),
      "--route-reason",
      "Decision and design phases are not needed for this bounded review",
      "--route-evidence-ref",
      "prd.md",
    );
    const phase1Revision = setArtifact(root, PHASE_1);
    runOk(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "1",
      "--artifact-revision",
      phase1Revision,
      "--result-ref",
      "prd.md",
      "--outcome-kind",
      "accepted",
      "--evidence-ref",
      "prd.md",
      "--user-confirmation-ref",
      "user-message:requirements-approved",
    );
    const phase5Revision = setArtifact(root, PHASE_5);
    runOk(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "1",
      "--artifact-revision",
      phase5Revision,
      "--result-ref",
      "prd.md",
      "--outcome-kind",
      "no_go",
      "--closeout-disposition",
      "no_go",
      "--evidence-ref",
      "prd.md",
    );
    runOk(root, "complete", TASK);
    const task = JSON.parse(
      fs.readFileSync(
        path.join(root, ".trellis", "tasks", TASK, "task.json"),
        "utf-8",
      ),
    );
    expect(task.status).toBe("completed");
    expect(task.meta.task_workflow.closeout_disposition).toBe("no_go");
  });

  it("requires a confirmed phase-5 review before cancellation", () => {
    runOk(
      root,
      "phase",
      "init",
      TASK,
      "--task-kind",
      "analysis",
      "--complexity",
      "simple",
      "--project-context",
      "existing",
      "--phase-ids",
      [PHASE_1, PHASE_5].join(","),
      "--route-reason",
      "Decision and design phases are not needed for this bounded review",
      "--route-evidence-ref",
      "prd.md",
    );
    const phase1Revision = setArtifact(root, PHASE_1);
    runOk(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "1",
      "--artifact-revision",
      phase1Revision,
      "--result-ref",
      "prd.md",
      "--outcome-kind",
      "accepted",
      "--evidence-ref",
      "prd.md",
      "--user-confirmation-ref",
      "user-message:requirements-approved",
    );
    runOk(
      root,
      "phase",
      "route",
      TASK,
      "--expected-route-revision",
      "1",
      "--phase-ids",
      PHASE_5,
      "--target-phase",
      PHASE_5,
      "--reason",
      "The user withdrew the task after requirements review",
      "--evidence-ref",
      "prd.md",
      "--user-confirmation-ref",
      "user-message:task-withdrawn",
    );
    const phase5Revision = setArtifact(root, PHASE_5);
    runOk(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "2",
      "--artifact-revision",
      phase5Revision,
      "--result-ref",
      "prd.md",
      "--outcome-kind",
      "cancelled",
      "--closeout-disposition",
      "cancelled",
      "--evidence-ref",
      "prd.md",
    );
    runOk(
      root,
      "cancel",
      TASK,
      "--reason",
      "The proposed change is not needed",
      "--evidence-ref",
      "prd.md",
    );
    const task = JSON.parse(
      fs.readFileSync(path.join(root, ".trellis", "tasks", TASK, "task.json"), "utf-8"),
    );
    expect(task.status).toBe("cancelled");
    expect(task.meta.task_cancellation.reason).toBe("The proposed change is not needed");
  });

  it("keeps continuity and ownership records distinct for repeated task slugs", () => {
    const otherPath = path.join(root, ".trellis", "tasks", "10-30-phase-workflow-test");
    fs.mkdirSync(otherPath, { recursive: true });
    fs.writeFileSync(path.join(otherPath, "prd.md"), "# Separate task\n");
    fs.writeFileSync(
      path.join(otherPath, "task.json"),
      JSON.stringify({ id: TASK, name: TASK, status: "in_progress", meta: {} }) + "\n",
    );
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Trellis test"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });

    runOkAs(root, "first-session", "start", TASK);
    const first = JSON.parse(runOkAs(root, "first-session", "continuity", "capture", "--expected-source-digest", "absent"));
    expect(first.status).toBe("ready");
    const args = ["--task-id", TASK, "--task-path", `.trellis/tasks/${TASK}`, "--package-id", "package-a", "--package-digest", "a".repeat(64), "--expected-generation", "0", "--explicit-user-request"];
    expect(JSON.parse(runOkAs(root, "first-session", "transfer", "quiesce", ...args)).status).toBe("quiescing");

    runOkAs(root, "second-session", "start", otherPath);
    const second = JSON.parse(runOkAs(root, "second-session", "continuity", "capture", "--expected-source-digest", "absent"));
    expect(second.status).toBe("ready");
    const secondStatus = JSON.parse(runOkAs(
      root,
      "second-session",
      "transfer",
      "status",
      "--task-id",
      TASK,
      "--task-path",
      ".trellis/tasks/10-30-phase-workflow-test",
      "--package-id",
      "package-b",
      "--package-digest",
      "b".repeat(64),
    ));
    expect(secondStatus.status).toBe("absent");
  });

  it("captures fresh continuity and fences explicit ownership transfer by generation", () => {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Trellis test"], { cwd: root });
    fs.writeFileSync(path.join(root, "evidence.md"), "continuity evidence\n");
    execFileSync("git", ["add", ".gitignore", ".trellis"], { cwd: root });
    execFileSync("git", ["add", "evidence.md"], { cwd: root });
    execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });

    runOkAs(root, "source-session", "start", TASK);
    runOkAs(
      root,
      "source-session",
      "phase",
      "init",
      TASK,
      "--task-kind",
      "analysis",
      "--complexity",
      "standard",
      "--project-context",
      "existing",
      "--phase-ids",
      [PHASE_1, PHASE_2, PHASE_3, PHASE_4, PHASE_5].join(","),
    );
    const beforeCapture = fs.readFileSync(
      path.join(root, ".trellis", "tasks", TASK, "task.json"),
      "utf-8",
    );
    const captured = JSON.parse(
      runOkAs(root, "source-session", "continuity", "capture", "--expected-source-digest", "absent"),
    ) as { status: string; source_digest: string };
    expect(captured.status).toBe("ready");
    expect(JSON.parse(fs.readFileSync(path.join(root, ".trellis", "tasks", TASK, "task.json"), "utf-8"))).toEqual(
      JSON.parse(beforeCapture),
    );
    expect(JSON.parse(runOkAs(root, "source-session", "continuity", "show")).status).toBe("ready");

    fs.appendFileSync(path.join(root, ".trellis", "tasks", TASK, "prd.md"), "changed\n");
    const staleContinuity = JSON.parse(runOkAs(root, "source-session", "continuity", "show"));
    expect(staleContinuity.status).toBe("stale");
    const staleCapture = runTaskAs(root, "source-session", "transfer", "quiesce", "--task-id", TASK, "--task-path", `.trellis/tasks/${TASK}`, "--package-id", "package-1", "--package-digest", "a".repeat(64), "--expected-generation", "0", "--explicit-user-request");
    expect(staleCapture.status).toBe(1);
    expect(staleCapture.stdout).toContain("TASK_TRANSFER_STALE_CONTINUITY");
    const refreshed = JSON.parse(runOkAs(
      root,
      "source-session",
      "continuity",
      "capture",
      "--expected-source-digest",
      staleContinuity.captured_source_digest,
    ));
    expect(refreshed.status).toBe("ready");

    const scriptPath = path.join(root, ".trellis", "scripts", "task.py");
    fs.appendFileSync(scriptPath, "\n# continuity content change\n");
    let changedContent = JSON.parse(runOkAs(root, "source-session", "continuity", "show"));
    expect(changedContent.status).toBe("stale");
    let recaptured = JSON.parse(runOkAs(root, "source-session", "continuity", "capture", "--expected-source-digest", changedContent.captured_source_digest));
    expect(recaptured.status).toBe("ready");
    fs.appendFileSync(scriptPath, "# another change with the same Git status\n");
    changedContent = JSON.parse(runOkAs(root, "source-session", "continuity", "show"));
    expect(changedContent.status).toBe("stale");
    recaptured = JSON.parse(runOkAs(root, "source-session", "continuity", "capture", "--expected-source-digest", changedContent.captured_source_digest));
    expect(recaptured.status).toBe("ready");

    const untrackedPath = path.join(root, "new-evidence.md");
    fs.writeFileSync(untrackedPath, "first version\n");
    changedContent = JSON.parse(runOkAs(root, "source-session", "continuity", "show"));
    expect(changedContent.status).toBe("stale");
    recaptured = JSON.parse(runOkAs(root, "source-session", "continuity", "capture", "--expected-source-digest", changedContent.captured_source_digest));
    expect(recaptured.status).toBe("ready");
    fs.writeFileSync(untrackedPath, "second version\n");
    changedContent = JSON.parse(runOkAs(root, "source-session", "continuity", "show"));
    expect(changedContent.status).toBe("stale");
    recaptured = JSON.parse(runOkAs(root, "source-session", "continuity", "capture", "--expected-source-digest", changedContent.captured_source_digest));
    expect(recaptured.status).toBe("ready");

    const packageArgs = ["--task-id", TASK, "--task-path", `.trellis/tasks/${TASK}`, "--package-id", "package-1", "--package-digest", "a".repeat(64)];
    const transfer = (session: string, action: string, generation: number) => runOkAs(
      root,
      session,
      "transfer",
      action,
      ...packageArgs,
      "--expected-generation",
      String(generation),
      "--explicit-user-request",
    );
    expect(JSON.parse(transfer("source-session", "quiesce", 0)).status).toBe("quiescing");
    const taskJsonPath = path.join(root, ".trellis", "tasks", TASK, "task.json");
    const taskJson = fs.readFileSync(taskJsonPath, "utf-8");
    fs.writeFileSync(taskJsonPath, "{ not json");
    expect(runTaskAs(root, "other-session", "start", TASK).status).toBe(1);
    fs.writeFileSync(taskJsonPath, taskJson);
    const fencedWrite = runTaskAs(root, "source-session", "phase", "artifact", TASK, "--expected-route-revision", "1", "--artifact-ref", "prd.md");
    expect(fencedWrite.status).toBe(1);
    expect(fencedWrite.stderr).toContain("TASK_TRANSFER_ACTIVE");
    const fencedMetadata = runTaskAs(root, "source-session", "set-meta", TASK, "owner", "source");
    expect(fencedMetadata.status).toBe(1);
    expect(fencedMetadata.stderr).toContain("TASK_TRANSFER_ACTIVE");
    const fencedContext = runTaskAs(root, "source-session", "add-context", TASK, "implement", "evidence.md");
    expect(fencedContext.status).toBe(1);
    expect(fencedContext.stdout + fencedContext.stderr).toContain("TASK_TRANSFER_ACTIVE");
    const released = transfer("source-session", "release", 1);
    expect(JSON.parse(released).status).toBe("released");
    expect(JSON.parse(runOkAs(root, "source-session", "current", "--json")).current_task.dir).toBe(`.trellis/tasks/${TASK}`);
    expect(JSON.parse(transfer("source-session", "quiesce", 0)).status).toBe("quiescing");
    expect(JSON.parse(transfer("source-session", "seal", 1)).status).toBe("sealed");
    expect(JSON.parse(transfer("source-session", "retire", 2)).status).toBe("ready");
    expect(JSON.parse(runTaskAs(root, "source-session", "current", "--json").stdout).current_task).toBeNull();
    const retiredSourceStart = runTaskAs(root, "source-session", "start", TASK);
    expect(retiredSourceStart.status).toBe(1);

    runOkAs(root, "target-session", "start", TASK);
    expect(JSON.parse(transfer("target-session", "claim", 3)).status).toBe("claimed");
    expect(JSON.parse(transfer("target-session", "consume", 4)).status).toBe("consumed");
    expect(JSON.parse(runOkAs(root, "target-session", "current", "--json")).current_task.dir).toBe(`.trellis/tasks/${TASK}`);
    const sourceRestart = runTaskAs(root, "source-session", "start", TASK);
    expect(sourceRestart.status).toBe(1);
    const activeRename = runTaskAs(root, "target-session", "rename", TASK, "renamed-phase-workflow-test");
    expect(activeRename.status).toBe(1);
    expect(activeRename.stderr).toContain("TASK_TRANSFER_TASK_ID_LOCKED");
    runOkAs(root, "target-session", "set-meta", TASK, "owner", "target");

    const staleGeneration = runTaskAs(root, "target-session", "transfer", "consume", ...packageArgs, "--expected-generation", "4", "--explicit-user-request");
    expect(staleGeneration.status).toBe(1);
    expect(staleGeneration.stdout).toContain("TASK_TRANSFER_STALE_GENERATION");
  });
});
