import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTaskWorkflowState } from "@pennixrv/trellis-core/task";
import { createHash } from "node:crypto";

const COVERAGE =
  "\n## 验收覆盖\n\n| 接受条件 | 工作包 | Owner | 验证入口 | 交付证据 | 停止条件 |\n| --- | --- | --- | --- | --- | --- |\n| scoped behavior | implement | cli | integration tests | test receipt | failed check |\n";

const TEMPLATE_SCRIPTS = path.resolve(
  __dirname,
  "../../src/templates/trellis/scripts",
);
const TASK = "10-31-phase-workflow-test";
const GOAL_EXPLORATION_AND_REQUIREMENTS = "goal_exploration_and_requirements";
const DECISION_SPACE_CONSTRUCTION_AND_MERGING =
  "decision_space_construction_and_merging";
const SOLUTION_DESIGN_AND_CONVERGENCE = "solution_design_and_convergence";
const TASK_IMPLEMENTATION = "task_implementation";
const DELIVERY_REVIEW_AND_CLOSEOUT = "delivery_review_and_closeout";

function taskDirectory(root: string, name = TASK): string {
  const tasks = path.join(root, ".trellis", "tasks");
  const candidates = ["planning", "in_progress", "cancelled"].map((status) =>
    path.join(tasks, status, name),
  );
  const completed = path.join(tasks, "completed");
  if (fs.existsSync(completed)) {
    candidates.push(
      ...fs
        .readdirSync(completed)
        .map((month) => path.join(completed, month, name)),
    );
  }
  const existing = candidates.filter((directory) => fs.existsSync(directory));
  if (existing.length > 1) throw new Error(`Ambiguous fixture: ${name}`);
  return existing[0] ?? path.join(tasks, "in_progress", name);
}

function planFixture(root: string): string {
  const directory = taskDirectory(root);
  const planning = path.join(root, ".trellis", "tasks", "planning", TASK);
  fs.mkdirSync(path.dirname(planning), { recursive: true });
  fs.renameSync(directory, planning);
  return path.join(planning, "task.json");
}

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function setupRepo(root: string): void {
  fs.writeFileSync(
    path.join(root, ".gitignore"),
    ".trellis/.runtime/\n__pycache__/\n",
  );
  const scriptsDir = path.join(root, ".trellis", "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.cpSync(TEMPLATE_SCRIPTS, scriptsDir, { recursive: true });
  const taskDir = taskDirectory(root, TASK);
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, "prd.md"), "# Requirements\n" + COVERAGE);
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
    throw new Error(
      `task.py ${args.join(" ")} failed: ${result.stdout} ${result.stderr}`,
    );
  }
  return result.stdout;
}

interface TaskWorkflowState {
  task_route_revision: string;
  task_kind: string;
  complexity: string;
  project_context: string;
  current_phase_id: string;
  phase_ids: string[];
  phases: Record<
    string,
    {
      artifact_revision?: string;
      input_revision?: string;
      result_revision?: string;
      status?: string;
      outcome_kind?: string;
      acceptance?: {
        artifact_revision?: string;
        result_revision?: string;
        input_revision?: string;
        task_route_revision?: string;
        evidence_refs?: string[];
      };
    }
  >;
  implementation_authorization: {
    contract_ref: string;
    contract_revision: string;
    approval_ref: string;
    task_route_revision: string;
  } | null;
  skip_records: Record<string, { reason: string }>;
  return_record: { evidence_refs?: string[] } | null;
}

function readState(root: string): TaskWorkflowState {
  const task = JSON.parse(
    fs.readFileSync(path.join(taskDirectory(root, TASK), "task.json"), "utf-8"),
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

function setArtifact(
  root: string,
  phase: string,
  artifactRef = "prd.md",
): string {
  const output = runOk(
    root,
    "phase",
    "artifact",
    TASK,
    "--expected-route-revision",
    readState(root).task_route_revision,
    "--artifact-ref",
    artifactRef,
  );
  const revision = JSON.parse(output).artifact_revision as string;
  expect(readState(root).phases[phase].artifact_revision).toBe(revision);
  return revision;
}

function accept(
  root: string,
  phase: string,
  outcome: string,
  options: string[] = [],
  artifactRef = "prd.md",
): void {
  const state = readState(root);
  const revision = setArtifact(root, phase, artifactRef);
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
    artifactRef,
    "--outcome-kind",
    outcome,
    "--evidence-ref",
    artifactRef,
    ...options,
  );
}

function prepareImplementationContract(root: string): string {
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
    [
      GOAL_EXPLORATION_AND_REQUIREMENTS,
      DECISION_SPACE_CONSTRUCTION_AND_MERGING,
      SOLUTION_DESIGN_AND_CONVERGENCE,
      TASK_IMPLEMENTATION,
      DELIVERY_REVIEW_AND_CLOSEOUT,
    ].join(","),
  );
  accept(root, GOAL_EXPLORATION_AND_REQUIREMENTS, "accepted", [
    "--evidence-ref",
    "user-message:requirements-approved",
  ]);
  runOk(
    root,
    "phase",
    "skip",
    TASK,
    "--expected-route-revision",
    readState(root).task_route_revision,
    "--reason",
    "No unresolved alternatives remain",
    "--evidence-ref",
    "prd.md",
  );
  const designPath = path.join(taskDirectory(root, TASK), "design.md");
  fs.writeFileSync(
    designPath,
    "# Accepted implementation contract\n" + COVERAGE,
  );
  accept(
    root,
    SOLUTION_DESIGN_AND_CONVERGENCE,
    "implementation_contract",
    [],
    "design.md",
  );
  return designPath;
}

function authorizeImplementation(
  root: string,
  contractRef: string,
  approvalRef = "user-message:implementation-approved",
): void {
  runOk(
    root,
    "phase",
    "authorize",
    TASK,
    "--expected-route-revision",
    readState(root).task_route_revision,
    "--contract-ref",
    contractRef,
    "--approval-ref",
    approvalRef,
  );
}

function createGitBaseline(root: string): string {
  execFileSync("git", ["init", "--initial-branch=main"], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Trellis test"], { cwd: root });
  execFileSync(
    "git",
    ["config", "user.email", "trellis-test@example.invalid"],
    { cwd: root },
  );
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "test baseline"], {
    cwd: root,
    stdio: "ignore",
  });
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf-8",
  }).trim();
}

function linkChildTask(root: string, admissionState = "ready"): string {
  const childId = "10-31-delegated-child";
  const childDir = taskDirectory(root, childId);
  fs.mkdirSync(childDir, { recursive: true });
  fs.writeFileSync(
    path.join(childDir, "prd.md"),
    "# Child implementation contract\nImplement the scoped change.\n" +
      COVERAGE,
  );
  const childTask = JSON.parse(
    fs.readFileSync(path.join(taskDirectory(root), "task.json"), "utf-8"),
  ) as Record<string, unknown>;
  Object.assign(childTask, {
    id: childId,
    name: childId,
    title: "Delegated child",
    branch: "test/delegated-child",
    base_branch: "main",
    parent: TASK,
    children: [],
    meta: {},
  });
  fs.writeFileSync(
    path.join(childDir, "task.json"),
    `${JSON.stringify(childTask, null, 2)}\n`,
  );
  const parentPath = path.join(taskDirectory(root), "task.json");
  const parentTask = JSON.parse(fs.readFileSync(parentPath, "utf-8")) as {
    children: string[];
    meta: Record<string, unknown>;
  };
  parentTask.children = [childId];
  fs.writeFileSync(parentPath, `${JSON.stringify(parentTask, null, 2)}\n`);
  runOk(
    root,
    "phase",
    "admission",
    TASK,
    "--expected-route-revision",
    readState(root).task_route_revision,
    "--dependency",
    "pennix-lifecycle",
    "--dependency",
    "paseo",
    "--dependency",
    "git",
    "--admission-state",
    admissionState,
    "--evidence-ref",
    "prd.md",
  );
  return childId;
}

function installPaseoStub(root: string): { binDir: string; callsFile: string } {
  const binDir = path.join(root, "test-bin");
  fs.mkdirSync(binDir, { recursive: true });
  const callsFile = path.join(root, "paseo-calls.jsonl");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const repo = process.env.PASEO_TEST_REPO;
const calls = process.env.PASEO_TEST_CALLS;
fs.appendFileSync(calls, JSON.stringify({ args }) + "\\n");
if (args[0] === "--version") { console.log("paseo test"); process.exit(0); }
if (args[0] === "workspace" && args[1] === "ls") {
  const worktree = path.join(repo, ".paseo-worktrees", "10-31-delegated-child");
  const rows = process.env.PASEO_TEST_WORKSPACE_ACTIVE === "0" ? [] : [{ workspaceId: "workspace-test-id", cwd: worktree }];
  console.log(JSON.stringify(rows));
  process.exit(0);
}
if (args[0] === "agent" && args[1] === "ls") {
  const status = process.env.PASEO_TEST_AGENT_STATUS || "closed";
  const rows = status === "none" ? [] : [{ id: process.env.PASEO_TEST_AGENT_ID || "agent-test-id", status, cwd: path.join(repo, ".paseo-worktrees", "10-31-delegated-child") }];
  console.log(JSON.stringify(rows));
  process.exit(0);
}
if (args[0] === "workspace" && args[1] === "create") {
  const value = (name) => args[args.indexOf(name) + 1];
  const worktree = path.join(repo, ".paseo-worktrees", value("--worktree-slug"));
  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  const result = spawnSync("git", ["-C", repo, "worktree", "add", "-b", value("--new-branch"), worktree, value("--base")], { encoding: "utf8" });
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(result.status || 1); }
  console.log(JSON.stringify({ workspaceId: "workspace-test-id", cwd: worktree }));
  process.exit(0);
}
if (args[0] === "run") {
  if (process.env.PASEO_TEST_FAIL_RUN === "1") { process.stderr.write("injected run failure"); process.exit(1); }
  console.log(JSON.stringify({ agentId: process.env.PASEO_TEST_RUN_AGENT_ID || "agent-test-id" }));
  process.exit(0);
}
process.stderr.write("unexpected Paseo arguments");
process.exit(2);
`;
  const executable = path.join(binDir, "paseo");
  fs.writeFileSync(executable, script, { mode: 0o755 });
  return { binDir, callsFile };
}

function runTaskWithEnv(
  root: string,
  env: NodeJS.ProcessEnv,
  ...args: string[]
) {
  return spawnSync("python3", [".trellis/scripts/task.py", ...args], {
    cwd: root,
    encoding: "utf-8",
    env: { ...process.env, ...env },
  });
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

  it("retains authorization for execution rework and invalidates it for contract change", () => {
    prepareImplementationContract(root);
    authorizeImplementation(root, "design.md");
    const authorization = readState(root).implementation_authorization;
    accept(root, TASK_IMPLEMENTATION, "verified");
    accept(root, DELIVERY_REVIEW_AND_CLOSEOUT, "delivery_ready", [
      "--closeout-disposition",
      "delivery_ready",
    ]);
    runOk(
      root,
      "phase",
      "return",
      TASK,
      "--expected-route-revision",
      "1",
      "--return-kind",
      "execution_rework",
      "--target-phase",
      TASK_IMPLEMENTATION,
      "--reason",
      "Repair behavior within the unchanged contract",
      "--evidence-ref",
      "review:local-defect",
    );
    expect(readState(root).implementation_authorization).toEqual(authorization);
    expect(readState(root).current_phase_id).toBe(TASK_IMPLEMENTATION);
    expect(
      readState(root).phases[DELIVERY_REVIEW_AND_CLOSEOUT].acceptance,
    ).toBeNull();
    expect(readState(root).return_record).toMatchObject({
      return_kind: "execution_rework",
      authorization_retained: true,
    });
    runOk(
      root,
      "phase",
      "return",
      TASK,
      "--expected-route-revision",
      "1",
      "--target-phase",
      SOLUTION_DESIGN_AND_CONVERGENCE,
      "--reason",
      "Contract needs a new behavior",
      "--evidence-ref",
      "review:contract-change",
    );
    expect(readState(root).implementation_authorization).toBeNull();
  });

  it.each(["requirements", "contract", "admission", "authorization", "target"])(
    "rejects execution rework with invalid %s without changing state",
    (invalid) => {
      prepareImplementationContract(root);
      authorizeImplementation(root, "design.md");
      if (invalid === "requirements")
        fs.appendFileSync(
          path.join(taskDirectory(root), "prd.md"),
          "Changed goal\n",
        );
      if (invalid === "contract")
        fs.appendFileSync(
          path.join(taskDirectory(root), "design.md"),
          "Changed contract\n",
        );
      if (invalid === "admission")
        runOk(
          root,
          "phase",
          "admission",
          TASK,
          "--expected-route-revision",
          "1",
          "--dependency",
          "git",
          "--admission-state",
          "blocked",
          "--evidence-ref",
          "check:blocked",
        );
      if (invalid === "authorization") {
        const taskPath = path.join(taskDirectory(root), "task.json");
        const task = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
        task.meta.task_workflow.implementation_authorization = null;
        fs.writeFileSync(taskPath, JSON.stringify(task));
      }
      const before = readState(root);
      const result = runTask(
        root,
        "phase",
        "return",
        TASK,
        "--expected-route-revision",
        "1",
        "--return-kind",
        "execution_rework",
        "--target-phase",
        invalid === "target"
          ? SOLUTION_DESIGN_AND_CONVERGENCE
          : TASK_IMPLEMENTATION,
        "--reason",
        "Attempt rework",
        "--evidence-ref",
        "review:defect",
      );
      expect(result.status).toBe(1);
      expect(readState(root)).toEqual(before);
    },
  );

  it("requires nonempty acceptance coverage before accepting an implementation contract", () => {
    const contract = prepareImplementationContract(root);
    runOk(
      root,
      "phase",
      "return",
      TASK,
      "--expected-route-revision",
      "1",
      "--target-phase",
      SOLUTION_DESIGN_AND_CONVERGENCE,
      "--reason",
      "Review coverage",
      "--evidence-ref",
      "review:coverage",
    );
    for (const content of [
      "# Contract\n",
      COVERAGE.replace("| scoped behavior |", "|  |"),
    ]) {
      fs.writeFileSync(contract, content);
      const revision = setArtifact(
        root,
        SOLUTION_DESIGN_AND_CONVERGENCE,
        "design.md",
      );
      const result = runTask(
        root,
        "phase",
        "accept",
        TASK,
        "--expected-route-revision",
        "1",
        "--artifact-revision",
        revision,
        "--result-ref",
        "design.md",
        "--outcome-kind",
        "implementation_contract",
        "--evidence-ref",
        "review:coverage",
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("TASK_PHASE_COVERAGE_REQUIRED");
    }
    fs.writeFileSync(contract, "# Contract\n" + COVERAGE);
    accept(
      root,
      SOLUTION_DESIGN_AND_CONVERGENCE,
      "implementation_contract",
      [],
      "design.md",
    );
  });

  it.each(["completed", "cancelled"])(
    "reopens %s into planning, preserving history and discarding old runtime and authorization",
    (status) => {
      prepareImplementationContract(root);
      authorizeImplementation(root, "design.md");
      const original = taskDirectory(root);
      const terminal =
        status === "completed"
          ? path.join(root, ".trellis/tasks/completed/2026-11", TASK)
          : path.join(root, ".trellis/tasks/cancelled", TASK);
      const task = JSON.parse(
        fs.readFileSync(path.join(original, "task.json"), "utf-8"),
      );
      task.status = status;
      task.completedAt = status === "completed" ? "2026-11-05" : null;
      task.meta.task_cancellation = {
        reason: "Temporary withdrawal",
        evidence_refs: ["user:withdraw"],
      };
      const cancellation = task.meta.task_cancellation;
      fs.writeFileSync(path.join(original, "task.json"), JSON.stringify(task));
      fs.mkdirSync(path.dirname(terminal), { recursive: true });
      fs.renameSync(original, terminal);
      const oldRef = path.relative(root, terminal);
      const key = createHash("sha256").update(oldRef).digest("hex");
      const runtimeFiles = [
        path.join(root, ".trellis/.runtime/sessions/stale.json"),
        ...["continuity", "task-ownership"].map((folder) =>
          path.join(root, ".trellis/.runtime", folder, key + ".json"),
        ),
      ];
      for (const file of runtimeFiles) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ current_task: oldRef }));
      }
      expect(
        runTask(
          root,
          "phase",
          "return",
          TASK,
          "--expected-route-revision",
          "1",
          "--target-phase",
          SOLUTION_DESIGN_AND_CONVERGENCE,
          "--reason",
          "Review again",
          "--evidence-ref",
          "user:reopen",
        ).stderr,
      ).toContain("TASK_PHASE_TASK_TERMINAL");
      runOk(
        root,
        "reopen",
        TASK,
        "--reason",
        "Continue the same review",
        "--evidence-ref",
        "user:reopen",
      );
      const reopened = JSON.parse(
        fs.readFileSync(path.join(taskDirectory(root), "task.json"), "utf-8"),
      );
      expect(reopened.status).toBe("planning");
      expect(reopened.id).toBe(task.id);
      expect(reopened.completedAt).toBeNull();
      expect(reopened.meta.task_cancellation).toEqual(cancellation);
      expect(reopened.meta.task_lifecycle_recoveries).toEqual([
        expect.objectContaining({
          from_status: status,
          to_status: "planning",
          reason: "Continue the same review",
          terminal_cancellation: cancellation,
        }),
      ]);
      expect(reopened.meta.task_workflow.current_phase_id).toBe(
        TASK_IMPLEMENTATION,
      );
      expect(
        reopened.meta.task_workflow.implementation_authorization,
      ).toBeNull();
      expect(runtimeFiles.every((file) => !fs.existsSync(file))).toBe(true);
      expect(fs.existsSync(terminal)).toBe(false);
      runOk(root, "start", TASK);
      expect(
        JSON.parse(
          fs.readFileSync(path.join(taskDirectory(root), "task.json"), "utf-8"),
        ).status,
      ).toBe("planning");
      expect(
        runTask(
          root,
          "reopen",
          TASK,
          "--reason",
          "Repeat",
          "--evidence-ref",
          "user:reopen",
        ).stderr,
      ).toContain("TASK_PHASE_REOPEN_INVALID_STATUS");
      runOk(
        root,
        "phase",
        "return",
        TASK,
        "--expected-route-revision",
        "1",
        "--target-phase",
        SOLUTION_DESIGN_AND_CONVERGENCE,
        "--reason",
        "Review new implementation contract",
        "--evidence-ref",
        "user:reopen",
      );
      accept(
        root,
        SOLUTION_DESIGN_AND_CONVERGENCE,
        "implementation_contract",
        [],
        "design.md",
      );
      authorizeImplementation(root, "design.md", "user:new-approval");
      runOk(root, "start", TASK);
      expect(
        JSON.parse(
          fs.readFileSync(path.join(taskDirectory(root), "task.json"), "utf-8"),
        ).status,
      ).toBe("in_progress");
    },
  );

  it("binds dependency admission to the current route and clears it when implementation artifacts change", () => {
    const designPath = prepareImplementationContract(root);
    authorizeImplementation(
      root,
      path.relative(taskDirectory(root, TASK), designPath),
    );
    const childId = linkChildTask(root);
    expect(childId).toBe("10-31-delegated-child");
    expect(readState(root)).toMatchObject({
      route_dependency_admission: {
        task_route_revision: "1",
        dependencies: ["pennix-lifecycle", "paseo", "git"],
        admission_state: "ready",
        evidence_refs: ["prd.md"],
      },
    });

    setArtifact(root, TASK_IMPLEMENTATION);
    expect(readState(root).route_dependency_admission).toBeNull();
  });

  it("does not invoke Paseo when the selected route dependency admission is blocked", () => {
    const designPath = prepareImplementationContract(root);
    authorizeImplementation(
      root,
      path.relative(taskDirectory(root, TASK), designPath),
    );
    const childId = linkChildTask(root, "blocked");
    const roleDir = path.join(root, ".trellis", "agents");
    fs.mkdirSync(roleDir, { recursive: true });
    fs.copyFileSync(
      path.resolve(
        __dirname,
        "../../src/templates/trellis/agents/delegated-worktree-primary-agent.md",
      ),
      path.join(roleDir, "delegated-worktree-primary-agent.md"),
    );
    createGitBaseline(root);
    const paseo = installPaseoStub(root);
    const result = runTaskWithEnv(
      root,
      {
        PATH: `${paseo.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        PASEO_TEST_REPO: root,
        PASEO_TEST_CALLS: paseo.callsFile,
      },
      "delegate-start",
      childId,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("TASK_DELEGATE_ADMISSION_REQUIRED");
    expect(fs.existsSync(paseo.callsFile)).toBe(false);
    const child = JSON.parse(
      fs.readFileSync(
        path.join(taskDirectory(root, childId), "task.json"),
        "utf-8",
      ),
    ) as { meta: Record<string, unknown> };
    expect(child.meta.delegated_worktree_execution_record).toBeUndefined();
    expect(fs.existsSync(path.join(root, ".paseo-worktrees", childId))).toBe(
      false,
    );
  });

  it.each([GOAL_EXPLORATION_AND_REQUIREMENTS, SOLUTION_DESIGN_AND_CONVERGENCE])(
    "returns an accepted implementation contract to %s before authorization",
    (target) => {
      const designPath = prepareImplementationContract(root);
      fs.writeFileSync(
        designPath,
        "# Revised implementation contract\n" + COVERAGE,
      );
      runOk(
        root,
        "phase",
        "return",
        TASK,
        "--expected-route-revision",
        "1",
        "--target-phase",
        target,
        "--reason",
        "Contract needs revision",
        "--evidence-ref",
        "user-message:revision",
      );
      const state = readState(root);
      expect(state.current_phase_id).toBe(target);
      expect(state.phases[target].status).toBe("active");
      expect(
        state.phases[SOLUTION_DESIGN_AND_CONVERGENCE].acceptance,
      ).toBeNull();
      expect(state.implementation_authorization).toBeNull();
      expect(parseTaskWorkflowState(state)).toEqual(state);
      if (target === SOLUTION_DESIGN_AND_CONVERGENCE) {
        accept(root, target, "implementation_contract", [], "design.md");
        authorizeImplementation(root, "design.md");
        expect(readState(root).current_phase_id).toBe(TASK_IMPLEMENTATION);
      }
    },
  );

  it.each(["block", "wait", "completed", "cancelled", "transfer"])(
    "does not dispatch a child when its parent or child is %s",
    (condition) => {
      prepareImplementationContract(root);
      authorizeImplementation(root, "design.md");
      const childId = linkChildTask(root);
      const childDir = taskDirectory(root, childId);
      if (condition === "block" || condition === "wait") {
        runOk(
          root,
          "phase",
          condition,
          TASK,
          "--expected-route-revision",
          "1",
          "--reason",
          "Implementation paused",
          "--evidence-ref",
          "user-message:pause",
        );
      } else if (condition === "completed" || condition === "cancelled") {
        const taskPath = path.join(childDir, "task.json");
        const child = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
        child.status = condition;
        fs.writeFileSync(taskPath, JSON.stringify(child));
        const destination = path.join(
          root,
          ".trellis",
          "tasks",
          condition,
          ...(condition === "completed" ? ["2026-11"] : []),
          childId,
        );
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.renameSync(childDir, destination);
      }
      const roleDir = path.join(root, ".trellis", "agents");
      fs.mkdirSync(roleDir, { recursive: true });
      fs.copyFileSync(
        path.resolve(
          __dirname,
          "../../src/templates/trellis/agents/delegated-worktree-primary-agent.md",
        ),
        path.join(roleDir, "delegated-worktree-primary-agent.md"),
      );
      createGitBaseline(root);
      if (condition === "transfer") {
        runOkAs(root, "source", "start", TASK);
        runOkAs(
          root,
          "source",
          "transfer",
          "quiesce",
          "--task-id",
          TASK,
          "--task-path",
          `.trellis/tasks/in_progress/${TASK}`,
          "--package-id",
          "package-delegate-fence",
          "--expected-generation",
          "0",
          "--package-digest",
          "a".repeat(64),
          "--explicit-user-request",
        );
      }
      const paseo = installPaseoStub(root);
      const childPath = path.join(taskDirectory(root, childId), "task.json");
      const before = fs.readFileSync(childPath, "utf-8");
      const result = runTaskWithEnv(
        root,
        {
          TRELLIS_CONTEXT_ID: "source",
          PATH: `${paseo.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
          PASEO_TEST_REPO: root,
          PASEO_TEST_CALLS: paseo.callsFile,
        },
        "delegate-start",
        childId,
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        condition === "transfer"
          ? "TASK_TRANSFER_ACTIVE"
          : condition === "completed" || condition === "cancelled"
            ? "TASK_DELEGATE_CHILD_TERMINAL"
            : "TASK_DELEGATE_IMPLEMENTATION_NOT_AUTHORIZED",
      );
      expect(fs.existsSync(paseo.callsFile)).toBe(false);
      expect(fs.readFileSync(childPath, "utf-8")).toBe(before);
      expect(fs.existsSync(path.join(root, ".paseo-worktrees", childId))).toBe(
        false,
      );
    },
  );

  it.each(["block", "wait"])(
    "withholds implementation start during %s",
    (action) => {
      const taskPath = planFixture(root);
      const task = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
      task.status = "planning";
      fs.writeFileSync(taskPath, JSON.stringify(task));
      prepareImplementationContract(root);
      authorizeImplementation(root, "design.md");
      runOk(
        root,
        "phase",
        action,
        TASK,
        "--expected-route-revision",
        "1",
        "--reason",
        "Implementation paused",
        "--evidence-ref",
        "user-message:pause",
      );
      const before = fs.readFileSync(taskPath, "utf-8");
      runOk(root, "start", TASK);
      expect(fs.readFileSync(taskPath, "utf-8")).toBe(before);
      expect(taskDirectory(root)).toContain(`${path.sep}planning${path.sep}`);
      runOk(root, "phase", "resume", TASK, "--expected-route-revision", "1");
      runOk(root, "start", TASK);
      expect(taskDirectory(root)).toContain(
        `${path.sep}in_progress${path.sep}`,
      );
    },
  );

  it("runs protocol v1 through native controller CLI and recovers unknown agent creation without replay", () => {
    prepareImplementationContract(root);
    authorizeImplementation(root, "design.md");
    const childId = linkChildTask(root);
    const childDir = taskDirectory(root, childId);
    const roleDir = path.join(root, ".trellis/agents");
    fs.mkdirSync(roleDir, { recursive: true });
    fs.copyFileSync(
      path.resolve(
        __dirname,
        "../../src/templates/trellis/agents/delegated-worktree-primary-agent.md",
      ),
      path.join(roleDir, "delegated-worktree-primary-agent.md"),
    );
    fs.writeFileSync(
      path.join(childDir, "settings.json"),
      JSON.stringify({
        version: 1,
        provider: "codex",
        model: "fixture-model",
        effort: "high",
        mode: "full-access",
      }),
    );
    fs.writeFileSync(
      path.join(childDir, "requirements.json"),
      JSON.stringify({ version: 1, allowed_paths: ["source.txt"] }),
    );
    createGitBaseline(root);
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const bind = () =>
      runTask(
        root,
        "delegate-bind",
        childId,
        "--target-repo",
        root,
        "--integration-branch",
        branch,
        "--settings-ref",
        "settings.json",
        "--requirements-ref",
        "requirements.json",
      );
    expect(bind().status).toBe(0);
    const bin = path.join(root, "fixture-bin");
    fs.mkdirSync(bin);
    fs.copyFileSync(
      path.join(__dirname, "fixtures/fake_paseo_adapter.py"),
      path.join(bin, "trellis-paseo-adapter"),
    );
    fs.chmodSync(path.join(bin, "trellis-paseo-adapter"), 0o755);
    const callsFile = path.join(root, "adapter-calls.jsonl");
    const env = {
      PATH: bin + path.delimiter + process.env.PATH,
      PASEO_TEST_REPO: root,
      PASEO_TEST_CALLS: callsFile,
    };
    const run = (...args: string[]) => runTaskWithEnv(root, env, ...args);
    const failed = runTaskWithEnv(
      root,
      { ...env, PASEO_TEST_FAIL_OPERATION: "prepare-agent" },
      "delegate-start",
      childId,
    );
    expect(failed.status).toBe(1);
    const recordPath = path.join(
      root,
      ".trellis/.runtime/delegation",
      childId,
      "record.json",
    );
    const pending = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    expect(pending.intent).toBe("prepare-agent");
    expect(run("delegate-start", childId).status).toBe(1);
    expect(bind().status).toBe(1);
    const recovered = run(
      "delegate-reconcile",
      childId,
      "--recover",
      "--workspace-id",
      "workspace-test-id",
      "--agent-id",
      "agent-test-id",
      "--execute",
      "--reason",
      "exact native resource mapping",
      "--approval-ref",
      "user:existing",
    );
    expect(recovered.status, recovered.stderr).toBe(0);
    const record = JSON.parse(recovered.stdout);
    const reportDir = path.join(
      record.worktree_path,
      ".trellis-delegation",
      record.attempt_id,
    );
    fs.mkdirSync(reportDir, { recursive: true });
    const base = {
      version: 1,
      attempt_id: record.attempt_id,
      binding_revision: record.binding.binding_revision,
      base_commit: record.binding.base_commit,
      head_commit: record.binding.base_commit,
      workspace_id: record.workspace_id,
      agent_id: record.agent_id,
      observations: {},
      limitations: [],
    };
    fs.writeFileSync(
      path.join(reportDir, "ready.json"),
      JSON.stringify({ ...base, kind: "ready", missing: [] }),
    );
    expect(run("delegate-execute", childId).status).toBe(0);
    fs.writeFileSync(
      path.join(record.worktree_path, "source.txt"),
      "real source result\n",
    );
    execFileSync("git", ["add", "source.txt"], { cwd: record.worktree_path });
    execFileSync(
      "git",
      ["-c", "commit.gpgsign=false", "commit", "-m", "fixture result"],
      { cwd: record.worktree_path },
    );
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: record.worktree_path,
      encoding: "utf8",
    }).trim();
    fs.writeFileSync(
      path.join(reportDir, "result.json"),
      JSON.stringify({
        ...base,
        kind: "result",
        head_commit: head,
        changed_paths: ["source.txt"],
        source_commits: [head],
        checks: ["fixture check passed"],
        remaining: [],
      }),
    );
    expect(run("delegate-reconcile", childId).status).toBe(1);
    execFileSync("git", ["merge", "--ff-only", head], { cwd: root });
    expect(run("delegate-reconcile", childId).status).toBe(0);
    fs.writeFileSync(
      path.join(childDir, "writers.md"),
      "Controller checked native process and resources; no background writer.",
    );
    const closed = run(
      "delegate-reconcile",
      childId,
      "--execute",
      "--reason",
      "reviewed and integrated",
      "--approval-ref",
      "user:existing",
      "--writer-evidence-ref",
      "writers.md",
    );
    expect(closed.status, closed.stderr).toBe(0);
    expect(JSON.parse(closed.stdout).status).toBe("retired");
    const calls = fs
      .readFileSync(callsFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      calls.filter((call) => call.operation === "prepare-workspace"),
    ).toHaveLength(1);
    expect(
      calls.filter((call) => call.operation === "prepare-agent"),
    ).toHaveLength(1);
    expect(calls.filter((call) => call.operation === "execute")).toHaveLength(
      1,
    );
    expect(fs.existsSync(record.worktree_path)).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(path.join(childDir, "task.json"), "utf8")).meta
        .delegated_worktree_execution_record,
    ).toBeUndefined();
  });

  it.each(["prd", "role"])(
    "refuses protocol v1 frozen %s drift before calling the adapter",
    (kind) => {
      prepareImplementationContract(root);
      authorizeImplementation(root, "design.md");
      const child = linkChildTask(root);
      const dir = taskDirectory(root, child),
        role = path.join(
          root,
          ".trellis/agents/delegated-worktree-primary-agent.md",
        );
      fs.mkdirSync(path.dirname(role), { recursive: true });
      fs.writeFileSync(role, "stable role");
      fs.writeFileSync(
        path.join(dir, "settings.json"),
        JSON.stringify({
          version: 1,
          provider: "codex",
          model: "fixture-model",
          effort: "high",
          mode: "full-access",
        }),
      );
      fs.writeFileSync(
        path.join(dir, "requirements.json"),
        JSON.stringify({ version: 1, allowed_paths: ["source.txt"] }),
      );
      createGitBaseline(root);
      const branch = execFileSync("git", ["branch", "--show-current"], {
        cwd: root,
        encoding: "utf8",
      }).trim();
      runOk(
        root,
        "delegate-bind",
        child,
        "--target-repo",
        root,
        "--integration-branch",
        branch,
        "--settings-ref",
        "settings.json",
        "--requirements-ref",
        "requirements.json",
      );
      fs.appendFileSync(
        kind === "prd" ? path.join(dir, "prd.md") : role,
        " changed",
      );
      const result = runTask(root, "delegate-start", child);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("frozen input");
      expect(fs.existsSync(path.join(root, ".paseo-worktrees"))).toBe(false);
    },
  );

  it("rejects task routes without Delivery Review and On-Site Closeout Phase", () => {
    const routeWithoutCloseout = runTask(
      root,
      "phase",
      "init",
      TASK,
      "--task-kind",
      "implementation",
      "--complexity",
      "standard",
      "--project-context",
      "existing",
      "--phase-ids",
      [GOAL_EXPLORATION_AND_REQUIREMENTS, SOLUTION_DESIGN_AND_CONVERGENCE].join(
        ",",
      ),
    );
    expect(routeWithoutCloseout.status).toBe(1);
    expect(routeWithoutCloseout.stderr).toContain(
      "--phase-ids must include Delivery Review and On-Site Closeout Phase",
    );
  });

  it("keeps task classification consistent with the route and refreshes it when rerouting", () => {
    const inconsistentInit = runTask(
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
      "--phase-ids",
      [
        GOAL_EXPLORATION_AND_REQUIREMENTS,
        DECISION_SPACE_CONSTRUCTION_AND_MERGING,
        SOLUTION_DESIGN_AND_CONVERGENCE,
        TASK_IMPLEMENTATION,
        DELIVERY_REVIEW_AND_CLOSEOUT,
      ].join(","),
    );
    expect(inconsistentInit.status).toBe(1);
    expect(inconsistentInit.stderr).toContain(
      "analysis tasks cannot include the Task Implementation and Test Verification Phase",
    );

    for (const taskKind of ["implementation", "combined"] as const) {
      const missingImplementationPhase = runTask(
        root,
        "phase",
        "init",
        TASK,
        "--task-kind",
        taskKind,
        "--complexity",
        "standard",
        "--project-context",
        "existing",
        "--phase-ids",
        [GOAL_EXPLORATION_AND_REQUIREMENTS, DELIVERY_REVIEW_AND_CLOSEOUT].join(
          ",",
        ),
        "--route-reason",
        "This route omits implementation",
        "--route-evidence-ref",
        "prd.md",
      );
      expect(missingImplementationPhase.status).toBe(1);
      expect(missingImplementationPhase.stderr).toContain(
        "implementation and combined tasks must include the Task Implementation and Test Verification Phase",
      );
    }

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
      "--phase-ids",
      [
        GOAL_EXPLORATION_AND_REQUIREMENTS,
        DECISION_SPACE_CONSTRUCTION_AND_MERGING,
        SOLUTION_DESIGN_AND_CONVERGENCE,
        DELIVERY_REVIEW_AND_CLOSEOUT,
      ].join(","),
      "--route-reason",
      "The initial request is analysis only",
      "--route-evidence-ref",
      "prd.md",
    );

    const inconsistentRouteArgs = [
      "phase",
      "route",
      TASK,
      "--expected-route-revision",
      "1",
      "--phase-ids",
      [
        GOAL_EXPLORATION_AND_REQUIREMENTS,
        DECISION_SPACE_CONSTRUCTION_AND_MERGING,
        SOLUTION_DESIGN_AND_CONVERGENCE,
        TASK_IMPLEMENTATION,
        DELIVERY_REVIEW_AND_CLOSEOUT,
      ].join(","),
      "--target-phase",
      TASK_IMPLEMENTATION,
      "--reason",
      "The accepted scope now includes implementation",
      "--evidence-ref",
      "prd.md",
    ];
    const inconsistentRoute = runTask(root, ...inconsistentRouteArgs);
    expect(inconsistentRoute.status).toBe(1);
    expect(inconsistentRoute.stderr).toContain(
      "analysis tasks cannot include the Task Implementation and Test Verification Phase",
    );
    expect(readState(root).task_route_revision).toBe("1");

    runOk(
      root,
      "phase",
      "route",
      TASK,
      "--expected-route-revision",
      "1",
      "--phase-ids",
      [
        GOAL_EXPLORATION_AND_REQUIREMENTS,
        DECISION_SPACE_CONSTRUCTION_AND_MERGING,
        SOLUTION_DESIGN_AND_CONVERGENCE,
        DELIVERY_REVIEW_AND_CLOSEOUT,
      ].join(","),
      "--target-phase",
      GOAL_EXPLORATION_AND_REQUIREMENTS,
      "--reason",
      "The task scope needs a deeper risk assessment",
      "--evidence-ref",
      "prd.md",
      "--complexity",
      "complex",
    );
    expect(readState(root)).toMatchObject({
      complexity: "complex",
      task_route_revision: "2",
    });

    runOk(
      root,
      "phase",
      "route",
      TASK,
      "--expected-route-revision",
      "2",
      "--phase-ids",
      [
        GOAL_EXPLORATION_AND_REQUIREMENTS,
        DECISION_SPACE_CONSTRUCTION_AND_MERGING,
        SOLUTION_DESIGN_AND_CONVERGENCE,
        TASK_IMPLEMENTATION,
        DELIVERY_REVIEW_AND_CLOSEOUT,
      ].join(","),
      "--target-phase",
      TASK_IMPLEMENTATION,
      "--reason",
      "The accepted scope now includes implementation",
      "--evidence-ref",
      "prd.md",
      "--task-kind",
      "implementation",
    );
    expect(readState(root)).toMatchObject({
      task_kind: "implementation",
      complexity: "complex",
      project_context: "existing",
      phase_ids: [
        GOAL_EXPLORATION_AND_REQUIREMENTS,
        DECISION_SPACE_CONSTRUCTION_AND_MERGING,
        SOLUTION_DESIGN_AND_CONVERGENCE,
        TASK_IMPLEMENTATION,
        DELIVERY_REVIEW_AND_CLOSEOUT,
      ],
      task_route_revision: "3",
    });
  });

  it("requires Goal Exploration and Requirements Confirmation Phase, rejects stale routes, and completes an authorized delivery", () => {
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
      [
        GOAL_EXPLORATION_AND_REQUIREMENTS,
        DECISION_SPACE_CONSTRUCTION_AND_MERGING,
        SOLUTION_DESIGN_AND_CONVERGENCE,
        TASK_IMPLEMENTATION,
        DELIVERY_REVIEW_AND_CLOSEOUT,
      ].join(","),
    );
    const goalRequirementsRevision = setArtifact(
      root,
      GOAL_EXPLORATION_AND_REQUIREMENTS,
    );
    const wrongPhase1Result = runTask(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "1",
      "--artifact-revision",
      goalRequirementsRevision,
      "--result-ref",
      "prd.md",
      "--outcome-kind",
      "needs_user_input",
      "--evidence-ref",
      "prd.md",
      "--evidence-ref",
      "user-message:requirements-approved",
    );
    expect(wrongPhase1Result.status).toBe(1);
    expect(wrongPhase1Result.stderr).toContain("phase_result=accepted");
    runOk(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "1",
      "--artifact-revision",
      goalRequirementsRevision,
      "--result-ref",
      "prd.md",
      "--outcome-kind",
      "accepted",
      "--evidence-ref",
      "prd.md",
      "--evidence-ref",
      "user-message:requirements-approved",
    );

    const droppedFirstPhase = runTask(
      root,
      "phase",
      "route",
      TASK,
      "--expected-route-revision",
      "1",
      "--phase-ids",
      DELIVERY_REVIEW_AND_CLOSEOUT,
      "--target-phase",
      DELIVERY_REVIEW_AND_CLOSEOUT,
      "--reason",
      "The user withdrew the task",
      "--evidence-ref",
      "prd.md",
      "--evidence-ref",
      "user-message:task-withdrawn",
    );
    expect(droppedFirstPhase.status).toBe(1);
    expect(droppedFirstPhase.stderr).toContain(
      "Goal Exploration and Requirements Confirmation Phase must remain first",
    );
    expect(readState(root).phase_ids).toEqual([
      GOAL_EXPLORATION_AND_REQUIREMENTS,
      DECISION_SPACE_CONSTRUCTION_AND_MERGING,
      SOLUTION_DESIGN_AND_CONVERGENCE,
      TASK_IMPLEMENTATION,
      DELIVERY_REVIEW_AND_CLOSEOUT,
    ]);
    runOk(
      root,
      "phase",
      "route",
      TASK,
      "--expected-route-revision",
      "1",
      "--phase-ids",
      [
        GOAL_EXPLORATION_AND_REQUIREMENTS,
        SOLUTION_DESIGN_AND_CONVERGENCE,
        TASK_IMPLEMENTATION,
        DELIVERY_REVIEW_AND_CLOSEOUT,
      ].join(","),
      "--target-phase",
      DECISION_SPACE_CONSTRUCTION_AND_MERGING,
      "--reason",
      "No unresolved alternatives or decision branches remain",
      "--evidence-ref",
      "prd.md",
    );
    expect(
      readState(root).skip_records[DECISION_SPACE_CONSTRUCTION_AND_MERGING]
        .reason,
    ).toMatch(/No unresolved/);
    const stale = runTask(
      root,
      "phase",
      "route",
      TASK,
      "--expected-route-revision",
      "1",
      "--phase-ids",
      [
        GOAL_EXPLORATION_AND_REQUIREMENTS,
        SOLUTION_DESIGN_AND_CONVERGENCE,
        TASK_IMPLEMENTATION,
        DELIVERY_REVIEW_AND_CLOSEOUT,
      ].join(","),
      "--target-phase",
      SOLUTION_DESIGN_AND_CONVERGENCE,
      "--reason",
      "stale update",
      "--evidence-ref",
      "prd.md",
    );
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain("TASK_PHASE_STALE_ROUTE");

    accept(root, SOLUTION_DESIGN_AND_CONVERGENCE, "implementation_contract");
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
    accept(root, TASK_IMPLEMENTATION, "implementation_complete");
    accept(root, DELIVERY_REVIEW_AND_CLOSEOUT, "delivery_ready", [
      "--closeout-disposition",
      "delivery_ready",
    ]);

    const task = JSON.parse(
      fs.readFileSync(
        path.join(taskDirectory(root, TASK), "task.json"),
        "utf-8",
      ),
    );
    expect(task.status).toBe("in_progress");
    expect(
      task.meta.task_workflow.phases[GOAL_EXPLORATION_AND_REQUIREMENTS]
        .acceptance.evidence_refs,
    ).toContain("user-message:requirements-approved");
    task.meta.delegated_worktree_execution_record = {
      agent_id: "agent-test-id",
    };
    fs.writeFileSync(
      path.join(taskDirectory(root, TASK), "task.json"),
      `${JSON.stringify(task)}\n`,
    );
    const paseo = installPaseoStub(root);
    const completeWithActiveAgent = runTaskWithEnv(
      root,
      {
        PATH: `${paseo.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        PASEO_TEST_REPO: root,
        PASEO_TEST_CALLS: paseo.callsFile,
        PASEO_TEST_AGENT_STATUS: "running",
      },
      "complete",
      TASK,
    );
    expect(completeWithActiveAgent.status).toBe(1);
    expect(completeWithActiveAgent.stderr).toContain(
      "TASK_PHASE_RESOURCE_ACTIVE",
    );
    const completeWithClosedAgent = runTaskWithEnv(
      root,
      {
        PATH: `${paseo.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        PASEO_TEST_REPO: root,
        PASEO_TEST_CALLS: paseo.callsFile,
        PASEO_TEST_AGENT_STATUS: "closed",
      },
      "complete",
      TASK,
    );
    expect(completeWithClosedAgent.status).toBe(0);
    const completed = JSON.parse(
      fs.readFileSync(
        path.join(taskDirectory(root, TASK), "task.json"),
        "utf-8",
      ),
    );
    expect(completed.status).toBe("completed");
    expect(fs.existsSync(path.join(root, ".trellis", "tasks", "archive"))).toBe(
      false,
    );
  });

  it("withholds authorization and implementation start when the accepted contract changes", () => {
    const designPath = prepareImplementationContract(root);
    fs.appendFileSync(designPath, "\nChanged after acceptance.\n");

    const staleAuthorization = runTask(
      root,
      "phase",
      "authorize",
      TASK,
      "--expected-route-revision",
      readState(root).task_route_revision,
      "--contract-ref",
      "design.md",
      "--approval-ref",
      "user-message:implementation-approved",
    );
    expect(staleAuthorization.status).toBe(1);
    expect(staleAuthorization.stderr).toContain("TASK_PHASE_STALE_ARTIFACT");
    expect(readState(root).implementation_authorization).toBeNull();
  });

  it("keeps task status in planning when the authorized contract changes before start", () => {
    const designPath = prepareImplementationContract(root);
    authorizeImplementation(root, "design.md");
    const taskPath = planFixture(root);
    const task = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
    task.status = "planning";
    fs.writeFileSync(taskPath, `${JSON.stringify(task)}\n`);
    fs.appendFileSync(
      path.join(taskDirectory(root), path.basename(designPath)),
      "\nChanged after authorization.\n",
    );

    const start = runTask(root, "start", TASK);
    expect(start.status).toBe(0);
    expect(start.stderr).toContain("TASK_PHASE_STALE_ARTIFACT");
    expect(JSON.parse(fs.readFileSync(taskPath, "utf-8")).status).toBe(
      "planning",
    );
  });

  it("keeps task status in planning when implementation authorization has no approval reference", () => {
    prepareImplementationContract(root);
    authorizeImplementation(root, "design.md");
    const taskPath = planFixture(root);
    const task = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
    task.status = "planning";
    task.meta.task_workflow.implementation_authorization.approval_ref = "  ";
    fs.writeFileSync(taskPath, `${JSON.stringify(task)}\n`);

    const start = runTask(root, "start", TASK);
    expect(start.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(taskPath, "utf-8")).status).toBe(
      "planning",
    );
  });

  it("keeps task status in planning when confirmed requirements change before start", () => {
    prepareImplementationContract(root);
    authorizeImplementation(root, "design.md");
    const taskPath = planFixture(root);
    const task = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
    task.status = "planning";
    fs.writeFileSync(taskPath, `${JSON.stringify(task)}\n`);
    fs.appendFileSync(
      path.join(taskDirectory(root, TASK), "prd.md"),
      "\nChanged requirements.\n",
    );

    const start = runTask(root, "start", TASK);
    expect(start.status).toBe(0);
    expect(start.stderr).toContain("TASK_PHASE_STALE_ARTIFACT");
    expect(JSON.parse(fs.readFileSync(taskPath, "utf-8")).status).toBe(
      "planning",
    );
  });

  it("keeps a deferred Solution Design and Convergence Phase result active until its trigger is resolved", () => {
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
      [
        GOAL_EXPLORATION_AND_REQUIREMENTS,
        DECISION_SPACE_CONSTRUCTION_AND_MERGING,
        SOLUTION_DESIGN_AND_CONVERGENCE,
        DELIVERY_REVIEW_AND_CLOSEOUT,
      ].join(","),
      "--route-reason",
      "Decision and design phases are not needed for this bounded review",
      "--route-evidence-ref",
      "prd.md",
    );
    const goalRequirementsRevision = setArtifact(
      root,
      GOAL_EXPLORATION_AND_REQUIREMENTS,
    );
    runOk(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "1",
      "--artifact-revision",
      goalRequirementsRevision,
      "--result-ref",
      "prd.md",
      "--outcome-kind",
      "accepted",
      "--evidence-ref",
      "prd.md",
      "--evidence-ref",
      "user-message:requirements-approved",
    );
    accept(root, DECISION_SPACE_CONSTRUCTION_AND_MERGING, "accepted");
    const revision = setArtifact(root, SOLUTION_DESIGN_AND_CONVERGENCE);
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
    expect(prematureAccept.stderr).toContain(
      "Solution Design and Convergence Phase must remain active",
    );
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
    expect(readState(root).current_phase_id).toBe(
      SOLUTION_DESIGN_AND_CONVERGENCE,
    );
    expect(readState(root).phases[SOLUTION_DESIGN_AND_CONVERGENCE].status).toBe(
      "blocked",
    );
    expect(
      readState(root).phases[SOLUTION_DESIGN_AND_CONVERGENCE].outcome_kind,
    ).toBe("deferred");
  });

  it("records a phase skip using its existing reason and evidence without an acceptance record", () => {
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
      [
        GOAL_EXPLORATION_AND_REQUIREMENTS,
        DECISION_SPACE_CONSTRUCTION_AND_MERGING,
        DELIVERY_REVIEW_AND_CLOSEOUT,
      ].join(","),
      "--route-reason",
      "The bounded task does not need the omitted phases",
      "--route-evidence-ref",
      "prd.md",
    );
    accept(root, GOAL_EXPLORATION_AND_REQUIREMENTS, "accepted");
    runOk(
      root,
      "phase",
      "skip",
      TASK,
      "--expected-route-revision",
      "1",
      "--reason",
      "No unresolved decision branch remains",
      "--evidence-ref",
      "prd.md",
    );

    const skipped =
      readState(root).phases[DECISION_SPACE_CONSTRUCTION_AND_MERGING];
    expect(skipped.status).toBe("skipped");
    expect(skipped.result_revision).toBe("0");
    expect(skipped.acceptance).toBeNull();
  });

  it("starts implementation when Solution Design and Convergence Phase is omitted with its contract as route evidence", () => {
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
      [
        GOAL_EXPLORATION_AND_REQUIREMENTS,
        TASK_IMPLEMENTATION,
        DELIVERY_REVIEW_AND_CLOSEOUT,
      ].join(","),
      "--route-reason",
      "The supplied contract resolves the omitted decision and design work",
      "--route-evidence-ref",
      "prd.md",
    );
    accept(root, GOAL_EXPLORATION_AND_REQUIREMENTS, "accepted", [
      "--evidence-ref",
      "user-message:requirements-approved",
    ]);
    runOk(
      root,
      "phase",
      "authorize",
      TASK,
      "--expected-route-revision",
      "1",
      "--contract-ref",
      "prd.md",
      "--approval-ref",
      "user-message:implementation-approved",
    );

    const taskPath = planFixture(root);
    const task = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
    task.status = "planning";
    fs.writeFileSync(taskPath, `${JSON.stringify(task)}\n`);
    runOk(root, "start", TASK);

    expect(
      JSON.parse(
        fs.readFileSync(path.join(taskDirectory(root), "task.json"), "utf-8"),
      ).status,
    ).toBe("in_progress");
  });

  it("discards invalidated skip decisions when returning to requirements", () => {
    prepareImplementationContract(root);
    authorizeImplementation(root, "design.md");
    runOk(
      root,
      "phase",
      "return",
      TASK,
      "--expected-route-revision",
      "1",
      "--target-phase",
      GOAL_EXPLORATION_AND_REQUIREMENTS,
      "--reason",
      "The requirements changed",
      "--evidence-ref",
      "user-message:change",
    );

    const state = readState(root);
    expect(
      state.skip_records[DECISION_SPACE_CONSTRUCTION_AND_MERGING],
    ).toBeUndefined();
    expect(parseTaskWorkflowState(state)).toEqual(state);
  });

  it.each(["start", "accept"])(
    "rejects %s when an authorized contract changes on a route without design",
    (action) => {
      const contractPath = path.join(taskDirectory(root, TASK), "contract.md");
      fs.writeFileSync(contractPath, "# Authorized scope\n" + COVERAGE);
      runOk(
        root,
        "phase",
        "init",
        TASK,
        "--task-kind",
        "implementation",
        "--complexity",
        "simple",
        "--project-context",
        "existing",
        "--phase-ids",
        [
          GOAL_EXPLORATION_AND_REQUIREMENTS,
          TASK_IMPLEMENTATION,
          DELIVERY_REVIEW_AND_CLOSEOUT,
        ].join(","),
        "--route-reason",
        "The supplied contract resolves design",
        "--route-evidence-ref",
        "contract.md",
      );
      accept(root, GOAL_EXPLORATION_AND_REQUIREMENTS, "accepted", [
        "--evidence-ref",
        "user-message:requirements-approved",
      ]);
      authorizeImplementation(root, "contract.md");
      expect(parseTaskWorkflowState(readState(root))).toEqual(readState(root));
      fs.writeFileSync(contractPath, "# Changed scope without new approval\n");
      const revision = setArtifact(root, TASK_IMPLEMENTATION);
      const taskPath = path.join(taskDirectory(root, TASK), "task.json");
      const before = fs.readFileSync(taskPath, "utf-8");
      const result =
        action === "start"
          ? runTask(root, "start", TASK)
          : runTask(
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
              "implemented",
              "--evidence-ref",
              "prd.md",
            );
      expect(result.status).toBe(action === "start" ? 0 : 1);
      expect(result.stderr).toContain("TASK_PHASE_STALE_ARTIFACT");
      if (action === "start") {
        expect(result.stderr).toContain("Implementation start withheld");
      }
      expect(fs.readFileSync(taskPath, "utf-8")).toBe(before);
    },
  );

  it("rejects implementation acceptance when its accepted design changes", () => {
    const designPath = prepareImplementationContract(root);
    authorizeImplementation(root, "design.md");
    fs.writeFileSync(designPath, "# Changed implementation scope\n");
    const revision = setArtifact(root, TASK_IMPLEMENTATION);
    const taskPath = path.join(taskDirectory(root, TASK), "task.json");
    const before = fs.readFileSync(taskPath, "utf-8");
    const result = runTask(
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
      "implemented",
      "--evidence-ref",
      "prd.md",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("TASK_PHASE_STALE_ARTIFACT");
    expect(fs.readFileSync(taskPath, "utf-8")).toBe(before);
  });

  it.each([
    ["return", TASK_IMPLEMENTATION],
    ["route", TASK_IMPLEMENTATION],
    ["return", DELIVERY_REVIEW_AND_CLOSEOUT],
    ["route", DELIVERY_REVIEW_AND_CLOSEOUT],
  ])(
    "allows %s to %s after delivery acceptance until task completion",
    (action, target) => {
      prepareImplementationContract(root);
      authorizeImplementation(root, "design.md");
      accept(root, TASK_IMPLEMENTATION, "implemented");
      accept(root, DELIVERY_REVIEW_AND_CLOSEOUT, "delivery_ready", [
        "--closeout-disposition",
        "delivery_ready",
      ]);

      runOk(
        root,
        "phase",
        action,
        TASK,
        "--expected-route-revision",
        "1",
        "--target-phase",
        target,
        "--reason",
        "Review found a defect",
        "--evidence-ref",
        "user-message:defect",
        ...(action === "route"
          ? ["--phase-ids", readState(root).phase_ids.join(",")]
          : []),
      );

      const state = readState(root);
      expect(state.current_phase_id).toBe(target);
      expect(state.implementation_authorization).toBeNull();
      expect(state.phases[DELIVERY_REVIEW_AND_CLOSEOUT].acceptance).toBeNull();
      expect(parseTaskWorkflowState(state)).toEqual(state);
      expect(runTask(root, "complete", TASK).status).toBe(1);
    },
  );

  it("rejects completion when an accepted implementation artifact changes after review", () => {
    prepareImplementationContract(root);
    authorizeImplementation(root, "design.md");
    const implementationPath = path.join(
      taskDirectory(root, TASK),
      "implementation.md",
    );
    fs.writeFileSync(implementationPath, "# Verified implementation\n");
    accept(root, TASK_IMPLEMENTATION, "implemented", [], "implementation.md");
    accept(root, DELIVERY_REVIEW_AND_CLOSEOUT, "delivery_ready", [
      "--closeout-disposition",
      "delivery_ready",
    ]);
    fs.writeFileSync(
      implementationPath,
      "# Changed implementation candidate\n",
    );
    const taskPath = path.join(taskDirectory(root, TASK), "task.json");
    const before = fs.readFileSync(taskPath, "utf-8");

    const result = runTask(root, "complete", TASK);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("TASK_PHASE_STALE_ARTIFACT");
    expect(fs.readFileSync(taskPath, "utf-8")).toBe(before);
  });

  it("rejects cancellation when the accepted cancellation review changes", () => {
    prepareImplementationContract(root);
    runOk(
      root,
      "phase",
      "route",
      TASK,
      "--expected-route-revision",
      "1",
      "--phase-ids",
      [GOAL_EXPLORATION_AND_REQUIREMENTS, DELIVERY_REVIEW_AND_CLOSEOUT].join(
        ",",
      ),
      "--target-phase",
      DELIVERY_REVIEW_AND_CLOSEOUT,
      "--reason",
      "User withdrew the task",
      "--return-kind",
      "withdrawal",
      "--task-kind",
      "analysis",
      "--evidence-ref",
      "user-message:withdrawn",
    );
    const reviewPath = path.join(taskDirectory(root, TASK), "review.md");
    fs.writeFileSync(reviewPath, "# Cancellation review\n");
    accept(
      root,
      DELIVERY_REVIEW_AND_CLOSEOUT,
      "cancelled",
      ["--closeout-disposition", "cancelled"],
      "review.md",
    );
    fs.writeFileSync(reviewPath, "# Resource disposal is now uncertain\n");
    const taskPath = path.join(taskDirectory(root, TASK), "task.json");
    const before = fs.readFileSync(taskPath, "utf-8");

    const result = runTask(
      root,
      "cancel",
      TASK,
      "--reason",
      "User withdrew the task",
      "--evidence-ref",
      "user-message:withdrawn",
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("TASK_PHASE_STALE_ARTIFACT");
    expect(fs.readFileSync(taskPath, "utf-8")).toBe(before);
  });

  it("rejects execution rework on an analysis route without an implementation phase", () => {
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
      [GOAL_EXPLORATION_AND_REQUIREMENTS, DELIVERY_REVIEW_AND_CLOSEOUT].join(
        ",",
      ),
      "--route-reason",
      "Bounded analysis",
      "--route-evidence-ref",
      "prd.md",
    );
    accept(root, GOAL_EXPLORATION_AND_REQUIREMENTS, "accepted", [
      "--evidence-ref",
      "user-message:confirmed",
    ]);
    const before = fs.readFileSync(
      path.join(taskDirectory(root), "task.json"),
      "utf8",
    );
    const result = runTask(
      root,
      "phase",
      "return",
      TASK,
      "--expected-route-revision",
      "1",
      "--target-phase",
      DELIVERY_REVIEW_AND_CLOSEOUT,
      "--return-kind",
      "execution_rework",
      "--reason",
      "Repeat analysis",
      "--evidence-ref",
      "prd.md",
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("TASK_PHASE_INVALID_TRANSITION");
    expect(result.stderr).not.toContain("Traceback");
    expect(
      fs.readFileSync(path.join(taskDirectory(root), "task.json"), "utf8"),
    ).toBe(before);
  });

  it("invalidates Goal Exploration and Requirements Confirmation Phase when its bound artifact changes", () => {
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
      "Verify Goal Exploration and Requirements Confirmation Phase artifact revision binding",
      "--route-evidence-ref",
      "prd.md",
      "--phase-ids",
      [
        GOAL_EXPLORATION_AND_REQUIREMENTS,
        DECISION_SPACE_CONSTRUCTION_AND_MERGING,
        DELIVERY_REVIEW_AND_CLOSEOUT,
      ].join(","),
    );
    const firstRevision = setArtifact(root, GOAL_EXPLORATION_AND_REQUIREMENTS);
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
      "--evidence-ref",
      "user-message:requirements-v1",
    );
    fs.writeFileSync(
      path.join(taskDirectory(root, TASK), "prd.md"),
      "# Revised requirements\n",
    );
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
      GOAL_EXPLORATION_AND_REQUIREMENTS,
      "--reason",
      "The confirmed requirement artifact changed",
      "--evidence-ref",
      "prd.md",
    );
    const revisedRevision = setArtifact(
      root,
      GOAL_EXPLORATION_AND_REQUIREMENTS,
    );
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
      "--evidence-ref",
      "user-message:requirements-v2",
    );
    expect(
      readState(root).phases[GOAL_EXPLORATION_AND_REQUIREMENTS].acceptance
        .evidence_refs,
    ).toContain("user-message:requirements-v2");
  });

  it("reclassifies an implementation-intent no-go to analysis before completion", () => {
    const taskPath = planFixture(root);
    const task = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
    task.status = "planning";
    fs.writeFileSync(taskPath, `${JSON.stringify(task)}\n`);
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
      [
        GOAL_EXPLORATION_AND_REQUIREMENTS,
        DECISION_SPACE_CONSTRUCTION_AND_MERGING,
        SOLUTION_DESIGN_AND_CONVERGENCE,
        TASK_IMPLEMENTATION,
        DELIVERY_REVIEW_AND_CLOSEOUT,
      ].join(","),
    );
    const goalRequirementsRevision = setArtifact(
      root,
      GOAL_EXPLORATION_AND_REQUIREMENTS,
    );
    runOk(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "1",
      "--artifact-revision",
      goalRequirementsRevision,
      "--result-ref",
      "prd.md",
      "--outcome-kind",
      "accepted",
      "--evidence-ref",
      "prd.md",
      "--evidence-ref",
      "user-message:requirements-approved",
    );
    accept(root, DECISION_SPACE_CONSTRUCTION_AND_MERGING, "accepted");
    runOk(
      root,
      "phase",
      "route",
      TASK,
      "--expected-route-revision",
      "1",
      "--phase-ids",
      [
        GOAL_EXPLORATION_AND_REQUIREMENTS,
        DECISION_SPACE_CONSTRUCTION_AND_MERGING,
        SOLUTION_DESIGN_AND_CONVERGENCE,
        DELIVERY_REVIEW_AND_CLOSEOUT,
      ].join(","),
      "--target-phase",
      SOLUTION_DESIGN_AND_CONVERGENCE,
      "--reason",
      "The no-go conclusion means no implementation work remains",
      "--evidence-ref",
      "prd.md",
      "--task-kind",
      "analysis",
    );
    accept(root, SOLUTION_DESIGN_AND_CONVERGENCE, "no_go", [
      "--result-ref",
      "prd.md",
    ]);
    const deliveryCloseoutRevision = setArtifact(
      root,
      DELIVERY_REVIEW_AND_CLOSEOUT,
    );
    runOk(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "2",
      "--artifact-revision",
      deliveryCloseoutRevision,
      "--result-ref",
      "prd.md",
      "--outcome-kind",
      "no_go",
      "--closeout-disposition",
      "no_go",
      "--evidence-ref",
      "prd.md",
    );
    expect(JSON.parse(fs.readFileSync(taskPath, "utf-8")).status).toBe(
      "planning",
    );
    runOk(root, "complete", TASK);
    const completedTask = JSON.parse(
      fs.readFileSync(path.join(taskDirectory(root), "task.json"), "utf-8"),
    );
    expect(completedTask.status).toBe("completed");
    expect(completedTask.meta.task_workflow.closeout_disposition).toBe("no_go");
    const completedStart = runTask(root, "start", TASK);
    expect(completedStart.status).toBe(1);
    expect(completedStart.stderr).toContain("TASK_PHASE_TASK_TERMINAL");
    runOk(
      root,
      "reopen",
      TASK,
      "--reason",
      "Review conclusion was incomplete",
      "--evidence-ref",
      "user:reopen",
    );
    expect(readState(root).current_phase_id).toBeNull();
    runOk(
      root,
      "phase",
      "return",
      TASK,
      "--expected-route-revision",
      "2",
      "--target-phase",
      SOLUTION_DESIGN_AND_CONVERGENCE,
      "--reason",
      "Complete the analysis",
      "--evidence-ref",
      "user:reopen",
    );
    expect(readState(root).current_phase_id).toBe(
      SOLUTION_DESIGN_AND_CONVERGENCE,
    );
  });

  it("requires confirmed Delivery Review and On-Site Closeout Phase before cancellation", () => {
    const childId = "10-31-cancel-child";
    const childDir = path.join(root, ".trellis", "tasks", "planning", childId);
    fs.mkdirSync(childDir, { recursive: true });
    const parentPath = path.join(taskDirectory(root, TASK), "task.json");
    const parentTask = JSON.parse(fs.readFileSync(parentPath, "utf-8"));
    parentTask.children = [childId];
    fs.writeFileSync(parentPath, `${JSON.stringify(parentTask)}\n`);
    fs.writeFileSync(
      path.join(childDir, "task.json"),
      `${JSON.stringify({ id: childId, name: childId, status: "planning", parent: TASK, children: [], meta: {} })}\n`,
    );
    runOk(
      root,
      "phase",
      "init",
      TASK,
      "--task-kind",
      "combined",
      "--complexity",
      "simple",
      "--project-context",
      "existing",
      "--phase-ids",
      [
        GOAL_EXPLORATION_AND_REQUIREMENTS,
        DECISION_SPACE_CONSTRUCTION_AND_MERGING,
        SOLUTION_DESIGN_AND_CONVERGENCE,
        TASK_IMPLEMENTATION,
        DELIVERY_REVIEW_AND_CLOSEOUT,
      ].join(","),
    );
    const goalRequirementsRevision = setArtifact(
      root,
      GOAL_EXPLORATION_AND_REQUIREMENTS,
    );
    runOk(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "1",
      "--artifact-revision",
      goalRequirementsRevision,
      "--result-ref",
      "prd.md",
      "--outcome-kind",
      "accepted",
      "--evidence-ref",
      "prd.md",
      "--evidence-ref",
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
      [GOAL_EXPLORATION_AND_REQUIREMENTS, DELIVERY_REVIEW_AND_CLOSEOUT].join(
        ",",
      ),
      "--target-phase",
      DELIVERY_REVIEW_AND_CLOSEOUT,
      "--reason",
      "The user withdrew the task after requirements review",
      "--return-kind",
      "withdrawal",
      "--task-kind",
      "analysis",
      "--evidence-ref",
      "prd.md",
      "--evidence-ref",
      "user-message:task-withdrawn",
    );
    expect(readState(root).phase_ids).toEqual([
      GOAL_EXPLORATION_AND_REQUIREMENTS,
      DELIVERY_REVIEW_AND_CLOSEOUT,
    ]);
    expect(readState(root).return_record?.evidence_refs).toContain(
      "user-message:task-withdrawn",
    );
    const deliveryCloseoutRevision = setArtifact(
      root,
      DELIVERY_REVIEW_AND_CLOSEOUT,
    );
    runOk(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "2",
      "--artifact-revision",
      deliveryCloseoutRevision,
      "--result-ref",
      "prd.md",
      "--outcome-kind",
      "cancelled",
      "--closeout-disposition",
      "cancelled",
      "--evidence-ref",
      "prd.md",
      "--child-disposition",
      `${childId}=continue`,
    );
    const childTask = JSON.parse(
      fs.readFileSync(path.join(childDir, "task.json"), "utf-8"),
    );
    childTask.meta.delegated_worktree_execution_record = {
      agent_id: "agent-test-id",
    };
    fs.writeFileSync(
      path.join(childDir, "task.json"),
      `${JSON.stringify(childTask)}\n`,
    );
    const paseo = installPaseoStub(root);
    const cancelWithActiveAgent = runTaskWithEnv(
      root,
      {
        PATH: `${paseo.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        PASEO_TEST_REPO: root,
        PASEO_TEST_CALLS: paseo.callsFile,
        PASEO_TEST_AGENT_STATUS: "running",
      },
      "cancel",
      TASK,
      "--reason",
      "The proposed change is not needed",
      "--evidence-ref",
      "prd.md",
    );
    expect(cancelWithActiveAgent.status).toBe(1);
    expect(cancelWithActiveAgent.stderr).toContain(
      "TASK_PHASE_RESOURCE_ACTIVE",
    );
    runTaskWithEnv(
      root,
      {
        PATH: `${paseo.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        PASEO_TEST_REPO: root,
        PASEO_TEST_CALLS: paseo.callsFile,
        PASEO_TEST_AGENT_STATUS: "closed",
      },
      "cancel",
      TASK,
      "--reason",
      "The proposed change is not needed",
      "--evidence-ref",
      "prd.md",
    );
    const task = JSON.parse(
      fs.readFileSync(
        path.join(taskDirectory(root, TASK), "task.json"),
        "utf-8",
      ),
    );
    expect(task.status).toBe("cancelled");
    const cancelledStart = runTask(root, "start", TASK);
    expect(cancelledStart.status).toBe(1);
    expect(cancelledStart.stderr).toContain("TASK_PHASE_TASK_TERMINAL");
    expect(task.meta.task_cancellation.reason).toBe(
      "The proposed change is not needed",
    );
    const unlink = runTask(root, "remove-subtask", TASK, childId);
    expect(unlink.status).toBe(1);
    expect(unlink.stderr).toContain("independently continuing");
    expect(
      JSON.parse(fs.readFileSync(path.join(childDir, "task.json"), "utf-8"))
        .parent,
    ).toBe(TASK);
  });

  it("routes withdrawal from Goal Exploration and Requirements Confirmation Phase through cancellation review", () => {
    runOk(
      root,
      "phase",
      "init",
      TASK,
      "--task-kind",
      "combined",
      "--complexity",
      "simple",
      "--project-context",
      "existing",
      "--phase-ids",
      [
        GOAL_EXPLORATION_AND_REQUIREMENTS,
        DECISION_SPACE_CONSTRUCTION_AND_MERGING,
        SOLUTION_DESIGN_AND_CONVERGENCE,
        TASK_IMPLEMENTATION,
        DELIVERY_REVIEW_AND_CLOSEOUT,
      ].join(","),
    );
    runOk(
      root,
      "phase",
      "route",
      TASK,
      "--expected-route-revision",
      "1",
      "--phase-ids",
      [GOAL_EXPLORATION_AND_REQUIREMENTS, DELIVERY_REVIEW_AND_CLOSEOUT].join(
        ",",
      ),
      "--target-phase",
      DELIVERY_REVIEW_AND_CLOSEOUT,
      "--reason",
      "The user withdrew the task during requirements alignment",
      "--return-kind",
      "withdrawal",
      "--task-kind",
      "analysis",
      "--evidence-ref",
      "prd.md",
      "--evidence-ref",
      "user-message:task-withdrawn",
    );

    const state = readState(root);
    expect(state.current_phase_id).toBe(DELIVERY_REVIEW_AND_CLOSEOUT);
    expect(state.phases[GOAL_EXPLORATION_AND_REQUIREMENTS].status).toBe(
      "skipped",
    );
    expect(
      state.skip_records[GOAL_EXPLORATION_AND_REQUIREMENTS].reason,
    ).toMatch(/withdrew/);
    expect(state.return_record?.evidence_refs).toContain(
      "user-message:task-withdrawn",
    );
    expect(parseTaskWorkflowState(state)).toEqual(state);

    const deliveryCloseoutRevision = setArtifact(
      root,
      DELIVERY_REVIEW_AND_CLOSEOUT,
    );
    runOk(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "2",
      "--artifact-revision",
      deliveryCloseoutRevision,
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
      "The user withdrew the task",
      "--evidence-ref",
      "prd.md",
    );
    runOk(
      root,
      "reopen",
      TASK,
      "--reason",
      "The user resumed the task",
      "--evidence-ref",
      "user:resume",
    );
    runOk(
      root,
      "phase",
      "return",
      TASK,
      "--expected-route-revision",
      "2",
      "--target-phase",
      GOAL_EXPLORATION_AND_REQUIREMENTS,
      "--reason",
      "Confirm requirements again",
      "--evidence-ref",
      "user:resume",
    );
    expect(readState(root).current_phase_id).toBe(
      GOAL_EXPLORATION_AND_REQUIREMENTS,
    );
  });

  it("includes initialized submodule worktree changes in continuity digests", () => {
    const origin = fs.mkdtempSync(
      path.join(os.tmpdir(), "trellis-continuity-submodule-origin-"),
    );
    const nestedOrigin = fs.mkdtempSync(
      path.join(os.tmpdir(), "trellis-continuity-nested-origin-"),
    );
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, { cwd, stdio: "ignore" });
    try {
      git(origin, "init", "--quiet", "--initial-branch=main");
      git(origin, "config", "user.email", "test@example.invalid");
      git(origin, "config", "user.name", "Trellis test");
      fs.writeFileSync(path.join(origin, "tracked.txt"), "base\n");
      git(origin, "add", ".");
      git(origin, "commit", "--quiet", "-m", "submodule baseline");

      git(nestedOrigin, "init", "--quiet", "--initial-branch=main");
      git(nestedOrigin, "config", "user.email", "test@example.invalid");
      git(nestedOrigin, "config", "user.name", "Trellis test");
      fs.writeFileSync(path.join(nestedOrigin, "nested.txt"), "nested base\n");
      git(nestedOrigin, "add", ".");
      git(nestedOrigin, "commit", "--quiet", "-m", "nested baseline");
      execFileSync(
        "git",
        [
          "-c",
          "protocol.file.allow=always",
          "submodule",
          "add",
          "--quiet",
          nestedOrigin,
          "nested",
        ],
        { cwd: origin, stdio: "ignore" },
      );
      git(origin, "commit", "--quiet", "-am", "add nested submodule");

      git(root, "init", "--quiet", "--initial-branch=main");
      git(root, "config", "user.email", "test@example.invalid");
      git(root, "config", "user.name", "Trellis test");
      execFileSync(
        "git",
        [
          "-c",
          "protocol.file.allow=always",
          "submodule",
          "add",
          "--quiet",
          origin,
          "module",
        ],
        { cwd: root, stdio: "ignore" },
      );
      execFileSync(
        "git",
        [
          "-c",
          "protocol.file.allow=always",
          "submodule",
          "update",
          "--init",
          "--recursive",
        ],
        { cwd: root, stdio: "ignore" },
      );
      git(root, "add", ".");
      git(root, "commit", "--quiet", "-m", "root baseline");
      runOkAs(root, "submodule-session", "start", TASK);

      const baseline = JSON.parse(
        runOkAs(root, "submodule-session", "continuity", "show"),
      );
      fs.writeFileSync(path.join(root, "module", "tracked.txt"), "changed\n");
      const changed = JSON.parse(
        runOkAs(root, "submodule-session", "continuity", "show"),
      );
      expect(changed.current.git.content_digest).not.toBe(
        baseline.current.git.content_digest,
      );
      expect(changed.current.git.submodules[0].status_digest).not.toBe(
        baseline.current.git.submodules[0].status_digest,
      );

      fs.writeFileSync(
        path.join(root, "module", "untracked.txt"),
        "new evidence\n",
      );
      const withUntracked = JSON.parse(
        runOkAs(root, "submodule-session", "continuity", "show"),
      );
      expect(withUntracked.current.git.content_digest).not.toBe(
        changed.current.git.content_digest,
      );
      fs.writeFileSync(
        path.join(root, "module", "nested", "nested.txt"),
        "nested changed\n",
      );
      const nestedChanged = JSON.parse(
        runOkAs(root, "submodule-session", "continuity", "show"),
      );
      expect(nestedChanged.current.git.content_digest).not.toBe(
        withUntracked.current.git.content_digest,
      );
    } finally {
      fs.rmSync(origin, { recursive: true, force: true });
      fs.rmSync(nestedOrigin, { recursive: true, force: true });
    }
  });

  it("keeps continuity and ownership records distinct for repeated task slugs", () => {
    const otherPath = path.join(
      root,
      ".trellis",
      "tasks",
      "in_progress",
      "10-30-phase-workflow-test",
    );
    fs.mkdirSync(otherPath, { recursive: true });
    fs.writeFileSync(path.join(otherPath, "prd.md"), "# Separate task\n");
    fs.writeFileSync(
      path.join(otherPath, "task.json"),
      JSON.stringify({
        id: TASK,
        name: TASK,
        status: "in_progress",
        meta: {},
      }) + "\n",
    );
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: root,
    });
    execFileSync("git", ["config", "user.name", "Trellis test"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });

    runOkAs(root, "first-session", "start", TASK);
    const first = JSON.parse(
      runOkAs(root, "first-session", "continuity", "show"),
    );
    expect(first.status).toBe("absent");
    const args = [
      "--task-id",
      TASK,
      "--task-path",
      `.trellis/tasks/in_progress/${TASK}`,
      "--package-id",
      "package-a",
      "--package-digest",
      "a".repeat(64),
      "--expected-continuity-digest",
      first.source_digest,
      "--expected-generation",
      "0",
      "--explicit-user-request",
    ];
    expect(
      JSON.parse(runOkAs(root, "first-session", "transfer", "quiesce", ...args))
        .status,
    ).toBe("quiescing");

    runOkAs(root, "second-session", "start", otherPath);
    const second = JSON.parse(
      runOkAs(root, "second-session", "continuity", "show"),
    );
    expect(second.status).toBe("absent");
    const secondStatus = JSON.parse(
      runOkAs(
        root,
        "second-session",
        "transfer",
        "status",
        "--task-id",
        TASK,
        "--task-path",
        ".trellis/tasks/in_progress/10-30-phase-workflow-test",
        "--package-id",
        "package-b",
        "--package-digest",
        "b".repeat(64),
      ),
    );
    expect(secondStatus.status).toBe("absent");
  });

  it("recovers a sealed source into an unbound direct session without changing its source digest", () => {
    const current = runTaskAs(root, "target-session", "current", "--json");
    expect(JSON.parse(current.stdout)).toMatchObject({
      current_task: null,
      session_source: "session:target-session",
      source: "none",
    });
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: root,
    });
    execFileSync("git", ["config", "user.name", "Trellis test"], { cwd: root });
    runOkAs(root, "source-session", "start", TASK);
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
    const taskPath = `.trellis/tasks/in_progress/${TASK}`;
    const taskBefore = fs.readFileSync(
      path.join(root, taskPath, "task.json"),
      "utf-8",
    );
    const sourceDigest = JSON.parse(
      runOkAs(root, "source-session", "continuity", "show"),
    ).source_digest as string;
    const packageArgs = [
      "--task-id",
      TASK,
      "--task-path",
      taskPath,
      "--package-id",
      "sealed-package",
      "--package-digest",
      "a".repeat(64),
    ];
    const transfer = (
      session: string,
      action: string,
      generation: number,
      ...extra: string[]
    ) =>
      runTaskAs(
        root,
        session,
        "transfer",
        action,
        ...packageArgs,
        "--expected-generation",
        String(generation),
        "--explicit-user-request",
        ...extra,
      );
    expect(
      JSON.parse(transfer("source-session", "quiesce", 0).stdout).status,
    ).toBe("quiescing");
    expect(
      JSON.parse(transfer("source-session", "seal", 1).stdout).status,
    ).toBe("sealed");
    fs.writeFileSync(
      path.join(root, "authorized-repair.md"),
      "Explicitly reviewed local repair\n",
    );
    const inspected = JSON.parse(
      transfer("target-session", "status", 2, "--include-current").stdout,
    );
    const targetDigest = inspected.current_continuity_digest as string;
    expect(inspected.current_projection.task).toMatchObject({
      id: TASK,
      path: taskPath,
    });
    expect(inspected.continuity_digest).toBe(sourceDigest);
    expect(
      JSON.parse(runTaskAs(root, "target-session", "current", "--json").stdout)
        .current_task,
    ).toBeNull();
    expect(targetDigest).not.toBe(sourceDigest);
    expect(JSON.parse(transfer("target-session", "claim", 2).stdout).code).toBe(
      "TASK_TRANSFER_STALE_CONTINUITY",
    );
    expect(
      JSON.parse(
        transfer(
          "target-session",
          "claim",
          2,
          "--expected-continuity-digest",
          sourceDigest,
        ).stdout,
      ).code,
    ).toBe("TASK_TRANSFER_STALE_CONTINUITY");
    expect(
      JSON.parse(
        transfer(
          "target-session",
          "claim",
          1,
          "--expected-continuity-digest",
          targetDigest,
        ).stdout,
      ).code,
    ).toBe("TASK_TRANSFER_STALE_GENERATION");
    expect(
      JSON.parse(
        transfer(
          "source-session",
          "claim",
          2,
          "--expected-continuity-digest",
          targetDigest,
        ).stdout,
      ).code,
    ).toBe("TASK_TRANSFER_WITHHELD");
    const unauthorized = runTaskAs(
      root,
      "target-session",
      "transfer",
      "claim",
      ...packageArgs,
      "--expected-generation",
      "2",
      "--expected-continuity-digest",
      targetDigest,
    );
    expect(JSON.parse(unauthorized.stdout).code).toBe(
      "TASK_TRANSFER_NOT_AUTHORIZED",
    );

    const sourcePointer = path.join(
      root,
      ".trellis",
      ".runtime",
      "sessions",
      "source-session.json",
    );
    const pointerBefore = fs.readFileSync(sourcePointer, "utf-8");
    fs.writeFileSync(sourcePointer, "{ not json");
    const interrupted = transfer(
      "target-session",
      "claim",
      2,
      "--expected-continuity-digest",
      targetDigest,
    );
    expect(JSON.parse(interrupted.stdout).code).toBe(
      "TASK_TRANSFER_RECOVERY_REQUIRED",
    );
    expect(JSON.parse(transfer("other-session", "claim", 3).stdout).code).toBe(
      "TASK_TRANSFER_WITHHELD",
    );
    const ownershipDir = path.join(
      root,
      ".trellis",
      ".runtime",
      "task-ownership",
    );
    const ownershipPath = path.join(
      ownershipDir,
      fs
        .readdirSync(ownershipDir)
        .find((name) => name.endsWith(".json")) as string,
    );
    const recovering = JSON.parse(fs.readFileSync(ownershipPath, "utf-8"));
    fs.writeFileSync(
      ownershipPath,
      JSON.stringify({ ...recovering, status: "claiming" }),
    );
    expect(JSON.parse(transfer("other-session", "claim", 3).stdout).code).toBe(
      "TASK_TRANSFER_WITHHELD",
    );
    fs.writeFileSync(sourcePointer, pointerBefore);
    const claimed = transfer("target-session", "claim", 3);
    expect(claimed.status).toBe(0);
    expect(JSON.parse(claimed.stdout)).toMatchObject({
      status: "claimed",
      generation: 3,
      source_session_id: "source-session",
      target_session_id: "target-session",
      continuity_digest: sourceDigest,
      target_continuity_digest: targetDigest,
    });
    expect(
      JSON.parse(runTaskAs(root, "source-session", "current", "--json").stdout)
        .current_task,
    ).toBeNull();
    expect(
      JSON.parse(runOkAs(root, "target-session", "current", "--json"))
        .current_task.dir,
    ).toBe(taskPath);
    expect(
      runTaskAs(root, "target-session", "set-meta", TASK, "owner", "premature")
        .status,
    ).toBe(1);
    expect(
      JSON.parse(transfer("other-session", "consume", 3).stdout).code,
    ).toBe("TASK_TRANSFER_WITHHELD");
    expect(
      JSON.parse(transfer("target-session", "consume", 3).stdout).status,
    ).toBe("consumed");
    fs.appendFileSync(
      path.join(root, "authorized-repair.md"),
      "A later reviewed repair\n",
    );
    const afterConsume = JSON.parse(
      transfer("target-session", "status", 4, "--include-current").stdout,
    );
    expect(afterConsume).toMatchObject({
      status: "consumed",
      generation: 4,
      continuity_digest: sourceDigest,
      target_continuity_digest: targetDigest,
    });
    expect(afterConsume.current_continuity_digest).not.toBe(targetDigest);
    expect(
      fs.readFileSync(path.join(root, taskPath, "task.json"), "utf-8"),
    ).toBe(taskBefore);
  });

  it("allows a consumed target to hand the task to a new session with a new package", () => {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync(
      "git",
      [
        "-c",
        "user.email=test@example.com",
        "-c",
        "user.name=Test",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ],
      { cwd: root },
    );
    const taskArgs = [
      "--task-id",
      TASK,
      "--task-path",
      `.trellis/tasks/in_progress/${TASK}`,
    ];
    const packageArgs = (id: string) => [
      "--package-id",
      id,
      "--package-digest",
      "a".repeat(64),
    ];
    const transfer = (
      session: string,
      action: string,
      id: string,
      generation: number,
    ) =>
      runTaskAs(
        root,
        session,
        "transfer",
        action,
        ...taskArgs,
        ...packageArgs(id),
        "--expected-generation",
        String(generation),
        "--explicit-user-request",
      );
    const step = (
      session: string,
      action: string,
      id: string,
      generation: number,
    ) => {
      const result = transfer(session, action, id, generation);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      return JSON.parse(result.stdout);
    };
    runOkAs(root, "source-session", "start", TASK);
    step("source-session", "quiesce", "first-package", 0);
    step("source-session", "seal", "first-package", 1);
    step("source-session", "retire", "first-package", 2);
    step("target-session", "claim", "first-package", 3);
    expect(step("target-session", "consume", "first-package", 4)).toMatchObject(
      { status: "consumed", generation: 5 },
    );

    runOkAs(root, "target-session", "set-meta", TASK, "continued_work", "true");
    const status = () =>
      JSON.parse(
        runOkAs(
          root,
          "target-session",
          "transfer",
          "status",
          ...taskArgs,
          "--include-current",
        ),
      );
    expect(status()).toMatchObject({
      status: "consumed",
      generation: 5,
      target_session_id: "target-session",
    });
    expect(
      transfer("target-session", "quiesce", "second-package", 0).stdout,
    ).toContain("TASK_TRANSFER_STALE_GENERATION");
    expect(
      transfer("target-session", "quiesce", "first-package", 5).stdout,
    ).toContain("TASK_TRANSFER_STALE_PACKAGE");
    expect(
      transfer("source-session", "quiesce", "second-package", 5).status,
    ).toBe(1);
    const unauthorized = runTaskAs(
      root,
      "target-session",
      "transfer",
      "quiesce",
      ...taskArgs,
      ...packageArgs("second-package"),
      "--expected-generation",
      "5",
    );
    expect(unauthorized.stdout).toContain("TASK_TRANSFER_NOT_AUTHORIZED");
    expect(status().generation).toBe(5);

    expect(
      step("target-session", "quiesce", "second-package", 5),
    ).toMatchObject({
      status: "quiescing",
      generation: 6,
      source_session_id: "target-session",
      target_session_id: null,
    });
    const oldPackage = runTaskAs(
      root,
      "target-session",
      "transfer",
      "status",
      ...taskArgs,
      ...packageArgs("first-package"),
    );
    expect(oldPackage.stdout).toContain("TASK_TRANSFER_STALE_PACKAGE");
    expect(runTaskAs(root, "source-session", "start", TASK).status).toBe(1);
    step("target-session", "seal", "second-package", 6);
    step("target-session", "retire", "second-package", 7);
    step("third-session", "claim", "second-package", 8);
    expect(step("third-session", "consume", "second-package", 9)).toMatchObject(
      {
        status: "consumed",
        generation: 10,
        target_session_id: "third-session",
      },
    );
    expect(
      runTaskAs(root, "target-session", "set-meta", TASK, "old_owner", "true")
        .status,
    ).toBe(1);
    runOkAs(root, "third-session", "set-meta", TASK, "new_owner", "true");
    expect(status().generation).toBe(10);
    for (const action of ["status", "quiesce"]) {
      const missingDigest = runTaskAs(
        root,
        "third-session",
        "transfer",
        action,
        ...taskArgs,
        "--package-id",
        "third-package",
      );
      expect(missingDigest.status).toBe(1);
      expect(missingDigest.stdout).toContain("TASK_TRANSFER_INVALID_INPUT");
    }
  });

  it("captures fresh continuity and fences explicit ownership transfer by generation", () => {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: root,
    });
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
      "combined",
      "--complexity",
      "standard",
      "--project-context",
      "existing",
      "--phase-ids",
      [
        GOAL_EXPLORATION_AND_REQUIREMENTS,
        DECISION_SPACE_CONSTRUCTION_AND_MERGING,
        SOLUTION_DESIGN_AND_CONVERGENCE,
        TASK_IMPLEMENTATION,
        DELIVERY_REVIEW_AND_CLOSEOUT,
      ].join(","),
    );
    const beforeCapture = fs.readFileSync(
      path.join(taskDirectory(root, TASK), "task.json"),
      "utf-8",
    );
    const captured = JSON.parse(
      runOkAs(
        root,
        "source-session",
        "continuity",
        "capture",
        "--expected-source-digest",
        "absent",
      ),
    ) as { status: string; source_digest: string };
    expect(captured.status).toBe("ready");
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(taskDirectory(root, TASK), "task.json"),
          "utf-8",
        ),
      ),
    ).toEqual(JSON.parse(beforeCapture));
    expect(
      JSON.parse(runOkAs(root, "source-session", "continuity", "show")).status,
    ).toBe("ready");

    fs.appendFileSync(
      path.join(taskDirectory(root, TASK), "prd.md"),
      "changed\n",
    );
    const staleContinuity = JSON.parse(
      runOkAs(root, "source-session", "continuity", "show"),
    );
    expect(staleContinuity.status).toBe("stale");
    const staleCapture = runTaskAs(
      root,
      "source-session",
      "transfer",
      "quiesce",
      "--task-id",
      TASK,
      "--task-path",
      `.trellis/tasks/in_progress/${TASK}`,
      "--package-id",
      "package-1",
      "--package-digest",
      "a".repeat(64),
      "--expected-continuity-digest",
      captured.source_digest,
      "--expected-generation",
      "0",
      "--explicit-user-request",
    );
    expect(staleCapture.status).toBe(1);
    expect(staleCapture.stdout).toContain("TASK_TRANSFER_STALE_CONTINUITY");
    const refreshed = JSON.parse(
      runOkAs(
        root,
        "source-session",
        "continuity",
        "capture",
        "--expected-source-digest",
        staleContinuity.captured_source_digest,
      ),
    );
    expect(refreshed.status).toBe("ready");

    const scriptPath = path.join(root, ".trellis", "scripts", "task.py");
    fs.appendFileSync(scriptPath, "\n# continuity content change\n");
    let changedContent = JSON.parse(
      runOkAs(root, "source-session", "continuity", "show"),
    );
    expect(changedContent.status).toBe("stale");
    let recaptured = JSON.parse(
      runOkAs(
        root,
        "source-session",
        "continuity",
        "capture",
        "--expected-source-digest",
        changedContent.captured_source_digest,
      ),
    );
    expect(recaptured.status).toBe("ready");
    fs.appendFileSync(
      scriptPath,
      "# another change with the same Git status\n",
    );
    changedContent = JSON.parse(
      runOkAs(root, "source-session", "continuity", "show"),
    );
    expect(changedContent.status).toBe("stale");
    recaptured = JSON.parse(
      runOkAs(
        root,
        "source-session",
        "continuity",
        "capture",
        "--expected-source-digest",
        changedContent.captured_source_digest,
      ),
    );
    expect(recaptured.status).toBe("ready");

    const untrackedPath = path.join(root, "new-evidence.md");
    fs.writeFileSync(untrackedPath, "first version\n");
    changedContent = JSON.parse(
      runOkAs(root, "source-session", "continuity", "show"),
    );
    expect(changedContent.status).toBe("stale");
    recaptured = JSON.parse(
      runOkAs(
        root,
        "source-session",
        "continuity",
        "capture",
        "--expected-source-digest",
        changedContent.captured_source_digest,
      ),
    );
    expect(recaptured.status).toBe("ready");
    fs.writeFileSync(untrackedPath, "second version\n");
    changedContent = JSON.parse(
      runOkAs(root, "source-session", "continuity", "show"),
    );
    expect(changedContent.status).toBe("stale");
    recaptured = JSON.parse(
      runOkAs(
        root,
        "source-session",
        "continuity",
        "capture",
        "--expected-source-digest",
        changedContent.captured_source_digest,
      ),
    );
    expect(recaptured.status).toBe("ready");

    const packageArgs = [
      "--task-id",
      TASK,
      "--task-path",
      `.trellis/tasks/in_progress/${TASK}`,
      "--package-id",
      "package-1",
      "--package-digest",
      "a".repeat(64),
    ];
    const currentDigest = JSON.parse(
      runOkAs(root, "source-session", "continuity", "show"),
    ).source_digest as string;
    const transfer = (session: string, action: string, generation: number) =>
      runOkAs(
        root,
        session,
        "transfer",
        action,
        ...packageArgs,
        ...(action === "quiesce"
          ? ["--expected-continuity-digest", currentDigest]
          : []),
        "--expected-generation",
        String(generation),
        "--explicit-user-request",
      );
    expect(JSON.parse(transfer("source-session", "quiesce", 0)).status).toBe(
      "quiescing",
    );
    const taskJsonPath = path.join(taskDirectory(root, TASK), "task.json");
    const taskJson = fs.readFileSync(taskJsonPath, "utf-8");
    fs.writeFileSync(taskJsonPath, "{ not json");
    expect(runTaskAs(root, "other-session", "start", TASK).status).toBe(1);
    fs.writeFileSync(taskJsonPath, taskJson);
    const fencedWrite = runTaskAs(
      root,
      "source-session",
      "phase",
      "artifact",
      TASK,
      "--expected-route-revision",
      "1",
      "--artifact-ref",
      "prd.md",
    );
    expect(fencedWrite.status).toBe(1);
    expect(fencedWrite.stderr).toContain("TASK_TRANSFER_ACTIVE");
    const fencedMetadata = runTaskAs(
      root,
      "source-session",
      "set-meta",
      TASK,
      "owner",
      "source",
    );
    expect(fencedMetadata.status).toBe(1);
    expect(fencedMetadata.stderr).toContain("TASK_TRANSFER_ACTIVE");
    const fencedContext = runTaskAs(
      root,
      "source-session",
      "add-context",
      TASK,
      "implement",
      "evidence.md",
    );
    expect(fencedContext.status).toBe(1);
    expect(fencedContext.stdout + fencedContext.stderr).toContain(
      "TASK_TRANSFER_ACTIVE",
    );
    const released = transfer("source-session", "release", 1);
    expect(JSON.parse(released).status).toBe("released");
    expect(
      JSON.parse(runOkAs(root, "source-session", "current", "--json"))
        .current_task.dir,
    ).toBe(`.trellis/tasks/in_progress/${TASK}`);
    expect(JSON.parse(transfer("source-session", "quiesce", 0)).status).toBe(
      "quiescing",
    );
    expect(JSON.parse(transfer("source-session", "seal", 1)).status).toBe(
      "sealed",
    );
    expect(JSON.parse(transfer("source-session", "retire", 2)).status).toBe(
      "ready",
    );
    expect(
      JSON.parse(runTaskAs(root, "source-session", "current", "--json").stdout)
        .current_task,
    ).toBeNull();
    const retiredSourceStart = runTaskAs(root, "source-session", "start", TASK);
    expect(retiredSourceStart.status).toBe(1);

    runOkAs(root, "target-session", "start", TASK);
    expect(JSON.parse(transfer("target-session", "claim", 3)).status).toBe(
      "claimed",
    );
    const targetWriteBeforeConsume = runTaskAs(
      root,
      "target-session",
      "set-meta",
      TASK,
      "owner",
      "premature",
    );
    expect(targetWriteBeforeConsume.status).toBe(1);
    expect(targetWriteBeforeConsume.stderr).toContain("TASK_TRANSFER_ACTIVE");

    const targetContextPath = path.join(
      root,
      ".trellis",
      ".runtime",
      "sessions",
      "target-session.json",
    );
    const targetContext = fs.readFileSync(targetContextPath, "utf-8");
    fs.writeFileSync(targetContextPath, "{ not json");
    const failedTakeover = runTaskAs(
      root,
      "replacement-session",
      "transfer",
      "claim",
      ...packageArgs,
      "--expected-generation",
      "4",
      "--explicit-user-request",
    );
    expect(failedTakeover.status).toBe(1);
    expect(failedTakeover.stdout).toContain("TASK_TRANSFER_RECOVERY_REQUIRED");
    expect(
      JSON.parse(transfer("replacement-session", "status", 4)),
    ).toMatchObject({
      status: "claimed",
      generation: 4,
      target_session_id: "target-session",
    });
    fs.writeFileSync(targetContextPath, targetContext);

    const takeover = JSON.parse(transfer("replacement-session", "claim", 4));
    expect(takeover).toMatchObject({
      status: "claimed",
      generation: 5,
      target_session_id: "replacement-session",
    });
    expect(
      JSON.parse(runTaskAs(root, "target-session", "current", "--json").stdout)
        .current_task,
    ).toBeNull();
    const staleTargetClaim = runTaskAs(
      root,
      "target-session",
      "transfer",
      "claim",
      ...packageArgs,
      "--expected-generation",
      "4",
      "--explicit-user-request",
    );
    expect(staleTargetClaim.status).toBe(1);
    expect(staleTargetClaim.stdout).toContain("TASK_TRANSFER_STALE_GENERATION");
    const previousTargetConsume = runTaskAs(
      root,
      "target-session",
      "transfer",
      "consume",
      ...packageArgs,
      "--expected-generation",
      "5",
      "--explicit-user-request",
    );
    expect(previousTargetConsume.status).toBe(1);
    expect(previousTargetConsume.stdout).toContain("TASK_TRANSFER_WITHHELD");
    const replacementWriteBeforeConsume = runTaskAs(
      root,
      "replacement-session",
      "set-meta",
      TASK,
      "owner",
      "premature",
    );
    expect(replacementWriteBeforeConsume.status).toBe(1);
    expect(replacementWriteBeforeConsume.stderr).toContain(
      "TASK_TRANSFER_ACTIVE",
    );
    const digest = JSON.parse(
      runOkAs(root, "replacement-session", "continuity", "show"),
    ).source_digest;
    const recovered = runTaskAs(
      root,
      "recovery-session",
      "transfer",
      "recover",
      ...packageArgs,
      "--expected-generation",
      "5",
      "--expected-continuity-digest",
      digest,
      "--explicit-user-request",
      "--reason",
      "target unavailable before consume",
    );
    expect(recovered.status, recovered.stdout + recovered.stderr).toBe(0);
    expect(JSON.parse(recovered.stdout)).toMatchObject({
      status: "ready",
      generation: 6,
      target_session_id: null,
    });
    expect(
      runTaskAs(
        root,
        "replacement-session",
        "transfer",
        "consume",
        ...packageArgs,
        "--expected-generation",
        "5",
        "--explicit-user-request",
      ).stdout,
    ).toContain("TASK_TRANSFER_STALE_GENERATION");
    expect(JSON.parse(transfer("replacement-session", "claim", 6)).status).toBe(
      "claimed",
    );
    expect(
      JSON.parse(transfer("replacement-session", "consume", 7)).status,
    ).toBe("consumed");
    expect(
      JSON.parse(runOkAs(root, "replacement-session", "current", "--json"))
        .current_task.dir,
    ).toBe(`.trellis/tasks/in_progress/${TASK}`);
    const sourceRestart = runTaskAs(root, "source-session", "start", TASK);
    expect(sourceRestart.status).toBe(1);
    const activeRename = runTaskAs(
      root,
      "replacement-session",
      "rename",
      TASK,
      "renamed-phase-workflow-test",
    );
    expect(activeRename.status).toBe(1);
    expect(activeRename.stderr).toContain("TASK_TRANSFER_TASK_ID_LOCKED");
    runOkAs(
      root,
      "replacement-session",
      "set-meta",
      TASK,
      "owner",
      "replacement",
    );

    const staleGeneration = runTaskAs(
      root,
      "replacement-session",
      "transfer",
      "consume",
      ...packageArgs,
      "--expected-generation",
      "5",
      "--explicit-user-request",
    );
    expect(staleGeneration.status).toBe(1);
    expect(staleGeneration.stdout).toContain("TASK_TRANSFER_STALE_GENERATION");
  });
});
