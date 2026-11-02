import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTaskWorkflowState } from "@pennixrv/trellis-core/task";

const TEMPLATE_SCRIPTS = path.resolve(
  __dirname,
  "../../src/templates/trellis/scripts",
);
const TASK = "10-31-phase-workflow-test";
const GOAL_EXPLORATION_AND_REQUIREMENTS = "goal_exploration_and_requirements";
const DECISION_SPACE_CONSTRUCTION_AND_MERGING = "decision_space_construction_and_merging";
const SOLUTION_DESIGN_AND_CONVERGENCE = "solution_design_and_convergence";
const TASK_IMPLEMENTATION = "task_implementation";
const DELIVERY_REVIEW_AND_CLOSEOUT = "delivery_review_and_closeout";

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
    approval_ref: string;
    task_route_revision: string;
  } | null;
  skip_records: Record<string, { reason: string }>;
  return_record: { evidence_refs?: string[] } | null;
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

function setArtifact(root: string, phase: string, artifactRef = "prd.md"): string {
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
    [GOAL_EXPLORATION_AND_REQUIREMENTS, DECISION_SPACE_CONSTRUCTION_AND_MERGING, SOLUTION_DESIGN_AND_CONVERGENCE, TASK_IMPLEMENTATION, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
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
  const designPath = path.join(root, ".trellis", "tasks", TASK, "design.md");
  fs.writeFileSync(designPath, "# Accepted implementation contract\n");
  accept(root, SOLUTION_DESIGN_AND_CONVERGENCE, "implementation_contract", [], "design.md");
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
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Trellis test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "trellis-test@example.invalid"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "test baseline"], { cwd: root, stdio: "ignore" });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" }).trim();
}

function linkChildTask(root: string, admissionState = "ready"): string {
  const tasksDir = path.join(root, ".trellis", "tasks");
  const childId = "10-31-delegated-child";
  const childDir = path.join(tasksDir, childId);
  fs.mkdirSync(childDir, { recursive: true });
  fs.writeFileSync(path.join(childDir, "prd.md"), "# Child implementation contract\nImplement the scoped change.\n");
  const childTask = JSON.parse(
    fs.readFileSync(path.join(tasksDir, TASK, "task.json"), "utf-8"),
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
  fs.writeFileSync(path.join(childDir, "task.json"), `${JSON.stringify(childTask, null, 2)}\n`);
  const parentPath = path.join(tasksDir, TASK, "task.json");
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

function runTaskWithEnv(root: string, env: NodeJS.ProcessEnv, ...args: string[]) {
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

  it("binds dependency admission to the current route and clears it when implementation artifacts change", () => {
    const designPath = prepareImplementationContract(root);
    authorizeImplementation(root, path.relative(path.join(root, ".trellis", "tasks", TASK), designPath));
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
    authorizeImplementation(root, path.relative(path.join(root, ".trellis", "tasks", TASK), designPath));
    const childId = linkChildTask(root, "blocked");
    const roleDir = path.join(root, ".trellis", "agents");
    fs.mkdirSync(roleDir, { recursive: true });
    fs.copyFileSync(
      path.resolve(__dirname, "../../src/templates/trellis/agents/delegated-worktree-primary-agent.md"),
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
      fs.readFileSync(path.join(root, ".trellis", "tasks", childId, "task.json"), "utf-8"),
    ) as { meta: Record<string, unknown> };
    expect(child.meta.delegated_worktree_execution_record).toBeUndefined();
    expect(fs.existsSync(path.join(root, ".paseo-worktrees", childId))).toBe(false);
  });

  it("starts an authorized child through Paseo and records its worktree and agent mapping", () => {
    const designPath = prepareImplementationContract(root);
    authorizeImplementation(root, path.relative(path.join(root, ".trellis", "tasks", TASK), designPath));
    const childId = linkChildTask(root);
    const roleDir = path.join(root, ".trellis", "agents");
    fs.mkdirSync(roleDir, { recursive: true });
    fs.copyFileSync(
      path.resolve(__dirname, "../../src/templates/trellis/agents/delegated-worktree-primary-agent.md"),
      path.join(roleDir, "delegated-worktree-primary-agent.md"),
    );
    const baseCommit = createGitBaseline(root);
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
    expect(result.status, result.stderr).toBe(0);
    const record = JSON.parse(result.stdout) as {
      workspace_id: string;
      worktree_path: string;
      agent_id: string;
      base_commit: string;
      status: string;
    };
    expect(record).toMatchObject({
      workspace_id: "workspace-test-id",
      agent_id: "agent-test-id",
      base_commit: baseCommit,
      status: "running",
    });
    expect(fs.existsSync(record.worktree_path)).toBe(true);
    const child = JSON.parse(
      fs.readFileSync(path.join(root, ".trellis", "tasks", childId, "task.json"), "utf-8"),
    ) as { meta: { delegated_worktree_execution_record: Record<string, unknown> } };
    expect(child.meta.delegated_worktree_execution_record).toMatchObject(record);
    const calls = fs
      .readFileSync(paseo.callsFile, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { args: string[] });
    expect(calls.map((call) => call.args[0])).toEqual(["--version", "workspace", "run"]);
    expect(calls[2]?.args.at(-1)).toContain("# Child implementation contract");
    expect(calls[2]?.args.at(-1)).toContain("sole task-specific implementation contract");
  });

  it("preserves an uncertain run and reuses or rebuilds resources only after reconciliation and fresh authorization", () => {
    const designPath = prepareImplementationContract(root);
    authorizeImplementation(root, path.relative(path.join(root, ".trellis", "tasks", TASK), designPath));
    const childId = linkChildTask(root);
    const roleDir = path.join(root, ".trellis", "agents");
    fs.mkdirSync(roleDir, { recursive: true });
    fs.copyFileSync(
      path.resolve(__dirname, "../../src/templates/trellis/agents/delegated-worktree-primary-agent.md"),
      path.join(roleDir, "delegated-worktree-primary-agent.md"),
    );
    createGitBaseline(root);
    const paseo = installPaseoStub(root);
    const env = {
      PATH: `${paseo.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      PASEO_TEST_REPO: root,
      PASEO_TEST_CALLS: paseo.callsFile,
      PASEO_TEST_FAIL_RUN: "1",
    };

    const failed = runTaskWithEnv(root, env, "delegate-start", childId);
    expect(failed.status, failed.stderr).toBe(1);
    expect(failed.stderr).toContain("TASK_DELEGATE_AGENT_START_FAILED");
    const childTaskPath = path.join(root, ".trellis", "tasks", childId, "task.json");
    const child = JSON.parse(fs.readFileSync(childTaskPath, "utf-8")) as {
      meta: { delegated_worktree_execution_record: Record<string, unknown> };
    };
    expect(child.meta.delegated_worktree_execution_record).toMatchObject({
      workspace_id: "workspace-test-id",
      status: "reconciliation_required",
      last_error: { code: "TASK_DELEGATE_AGENT_START_FAILED" },
    });
    expect(fs.existsSync(child.meta.delegated_worktree_execution_record.worktree_path as string)).toBe(true);

    const retryWithoutAuthorization = runTaskWithEnv(root, env, "delegate-start", childId);
    expect(retryWithoutAuthorization.status).toBe(1);
    expect(retryWithoutAuthorization.stderr).toContain("TASK_DELEGATE_REAUTHORIZATION_REQUIRED");

    authorizeImplementation(root, path.relative(path.join(root, ".trellis", "tasks", TASK), designPath), "user-message:retry-approved");
    const retryEnv: NodeJS.ProcessEnv = { ...env };
    delete retryEnv.PASEO_TEST_FAIL_RUN;
    const activeAgent = runTaskWithEnv(
      root,
      { ...retryEnv, PASEO_TEST_AGENT_STATUS: "running" },
      "delegate-start",
      childId,
    );
    expect(activeAgent.status).toBe(1);
    expect(activeAgent.stderr).toContain("TASK_DELEGATE_RECONCILIATION_REQUIRED");

    const mappedWorktree = child.meta.delegated_worktree_execution_record.worktree_path as string;
    const untrackedFile = path.join(mappedWorktree, "untracked-result.md");
    fs.writeFileSync(untrackedFile, "preserve this result\n");
    const dirtyWorkspace = runTaskWithEnv(
      root,
      { ...retryEnv, PASEO_TEST_AGENT_STATUS: "closed" },
      "delegate-start",
      childId,
    );
    expect(dirtyWorkspace.status).toBe(1);
    expect(dirtyWorkspace.stderr).toContain("TASK_DELEGATE_RECONCILIATION_REQUIRED");
    expect(fs.readFileSync(untrackedFile, "utf-8")).toBe("preserve this result\n");
    fs.rmSync(untrackedFile);

    const retry = runTaskWithEnv(
      root,
      {
        ...retryEnv,
        PASEO_TEST_AGENT_STATUS: "closed",
        PASEO_TEST_RUN_AGENT_ID: "agent-retried-id",
      },
      "delegate-start",
      childId,
    );
    expect(retry.status, retry.stderr).toBe(0);
    const retriedRecord = JSON.parse(retry.stdout) as Record<string, unknown>;
    expect(retriedRecord).toMatchObject({
      workspace_id: "workspace-test-id",
      agent_id: "agent-retried-id",
      base_commit: child.meta.delegated_worktree_execution_record.base_commit,
      authorization_ref: "user-message:retry-approved",
      status: "running",
    });
    const calls = fs.readFileSync(paseo.callsFile, "utf-8").trim().split("\n").map((line) => JSON.parse(line).args as string[]);
    expect(calls.filter((args) => args[0] === "workspace" && args[1] === "create")).toHaveLength(1);
    expect(calls.filter((args) => args[0] === "run")).toHaveLength(2);

    const retriedWorktree = retriedRecord.worktree_path as string;
    authorizeImplementation(root, path.relative(path.join(root, ".trellis", "tasks", TASK), designPath), "user-message:retry-after-cleanup-approved");
    execFileSync("git", ["worktree", "remove", "--force", retriedWorktree], { cwd: root });
    execFileSync("git", ["branch", "-D", "test/delegated-child"], { cwd: root });
    const rebuilt = runTaskWithEnv(
      root,
      {
        ...retryEnv,
        PASEO_TEST_WORKSPACE_ACTIVE: "0",
        PASEO_TEST_AGENT_STATUS: "closed",
        PASEO_TEST_AGENT_ID: "agent-retried-id",
        PASEO_TEST_RUN_AGENT_ID: "agent-rebuilt-id",
      },
      "delegate-start",
      childId,
    );
    expect(rebuilt.status, rebuilt.stderr).toBe(0);
    expect(JSON.parse(rebuilt.stdout)).toMatchObject({
      agent_id: "agent-rebuilt-id",
      authorization_ref: "user-message:retry-after-cleanup-approved",
      status: "running",
    });
    const finalCalls = fs.readFileSync(paseo.callsFile, "utf-8").trim().split("\n").map((line) => JSON.parse(line).args as string[]);
    expect(finalCalls.filter((args) => args[0] === "workspace" && args[1] === "create")).toHaveLength(2);
    expect(finalCalls.filter((args) => args[0] === "run")).toHaveLength(3);
  });

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
      [GOAL_EXPLORATION_AND_REQUIREMENTS, SOLUTION_DESIGN_AND_CONVERGENCE].join(","),
    );
    expect(routeWithoutCloseout.status).toBe(1);
    expect(routeWithoutCloseout.stderr).toContain("--phase-ids must include Delivery Review and On-Site Closeout Phase");
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
      [GOAL_EXPLORATION_AND_REQUIREMENTS, DECISION_SPACE_CONSTRUCTION_AND_MERGING, SOLUTION_DESIGN_AND_CONVERGENCE, TASK_IMPLEMENTATION, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
    );
    expect(inconsistentInit.status).toBe(1);
    expect(inconsistentInit.stderr).toContain("analysis tasks cannot include the Task Implementation and Test Verification Phase");

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
      [GOAL_EXPLORATION_AND_REQUIREMENTS, DECISION_SPACE_CONSTRUCTION_AND_MERGING, SOLUTION_DESIGN_AND_CONVERGENCE, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
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
      [GOAL_EXPLORATION_AND_REQUIREMENTS, DECISION_SPACE_CONSTRUCTION_AND_MERGING, SOLUTION_DESIGN_AND_CONVERGENCE, TASK_IMPLEMENTATION, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
      "--target-phase",
      TASK_IMPLEMENTATION,
      "--reason",
      "The accepted scope now includes implementation",
      "--evidence-ref",
      "prd.md",
    ];
    const inconsistentRoute = runTask(root, ...inconsistentRouteArgs);
    expect(inconsistentRoute.status).toBe(1);
    expect(inconsistentRoute.stderr).toContain("analysis tasks cannot include the Task Implementation and Test Verification Phase");
    expect(readState(root).task_route_revision).toBe("1");

    runOk(
      root,
      "phase",
      "route",
      TASK,
      "--expected-route-revision",
      "1",
      "--phase-ids",
      [GOAL_EXPLORATION_AND_REQUIREMENTS, DECISION_SPACE_CONSTRUCTION_AND_MERGING, SOLUTION_DESIGN_AND_CONVERGENCE, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
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
      [GOAL_EXPLORATION_AND_REQUIREMENTS, DECISION_SPACE_CONSTRUCTION_AND_MERGING, SOLUTION_DESIGN_AND_CONVERGENCE, TASK_IMPLEMENTATION, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
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
      phase_ids: [GOAL_EXPLORATION_AND_REQUIREMENTS, DECISION_SPACE_CONSTRUCTION_AND_MERGING, SOLUTION_DESIGN_AND_CONVERGENCE, TASK_IMPLEMENTATION, DELIVERY_REVIEW_AND_CLOSEOUT],
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
      [GOAL_EXPLORATION_AND_REQUIREMENTS, DECISION_SPACE_CONSTRUCTION_AND_MERGING, SOLUTION_DESIGN_AND_CONVERGENCE, TASK_IMPLEMENTATION, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
    );
    const goalRequirementsRevision = setArtifact(root, GOAL_EXPLORATION_AND_REQUIREMENTS);
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
    expect(droppedFirstPhase.stderr).toContain("Goal Exploration and Requirements Confirmation Phase must remain first");
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
      [GOAL_EXPLORATION_AND_REQUIREMENTS, SOLUTION_DESIGN_AND_CONVERGENCE, TASK_IMPLEMENTATION, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
      "--target-phase",
      DECISION_SPACE_CONSTRUCTION_AND_MERGING,
      "--reason",
      "No unresolved alternatives or decision branches remain",
      "--evidence-ref",
      "prd.md",
    );
    expect(readState(root).skip_records[DECISION_SPACE_CONSTRUCTION_AND_MERGING].reason).toMatch(/No unresolved/);
    const stale = runTask(
      root,
      "phase",
      "route",
      TASK,
      "--expected-route-revision",
      "1",
      "--phase-ids",
      [GOAL_EXPLORATION_AND_REQUIREMENTS, SOLUTION_DESIGN_AND_CONVERGENCE, TASK_IMPLEMENTATION, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
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
    accept(root, DELIVERY_REVIEW_AND_CLOSEOUT, "delivery_ready", ["--closeout-disposition", "delivery_ready"]);

    const task = JSON.parse(
      fs.readFileSync(
        path.join(root, ".trellis", "tasks", TASK, "task.json"),
        "utf-8",
      ),
    );
    expect(task.status).toBe("in_progress");
    expect(task.meta.task_workflow.phases[GOAL_EXPLORATION_AND_REQUIREMENTS].acceptance.evidence_refs).toContain("user-message:requirements-approved");
    task.meta.delegated_worktree_execution_record = { agent_id: "agent-test-id" };
    fs.writeFileSync(path.join(root, ".trellis", "tasks", TASK, "task.json"), `${JSON.stringify(task)}\n`);
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
    expect(completeWithActiveAgent.stderr).toContain("TASK_PHASE_RESOURCE_ACTIVE");
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
        path.join(root, ".trellis", "tasks", TASK, "task.json"),
        "utf-8",
      ),
    );
    expect(completed.status).toBe("completed");
    expect(fs.existsSync(path.join(root, ".trellis", "tasks", "archive"))).toBe(false);
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
    const taskPath = path.join(root, ".trellis", "tasks", TASK, "task.json");
    const task = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
    task.status = "planning";
    fs.writeFileSync(taskPath, `${JSON.stringify(task)}\n`);
    fs.appendFileSync(designPath, "\nChanged after authorization.\n");

    const start = runTask(root, "start", TASK);
    expect(start.status).toBe(0);
    expect(start.stderr).toContain("TASK_PHASE_STALE_ARTIFACT");
    expect(JSON.parse(fs.readFileSync(taskPath, "utf-8")).status).toBe("planning");
  });

  it("keeps task status in planning when implementation authorization has no approval reference", () => {
    prepareImplementationContract(root);
    authorizeImplementation(root, "design.md");
    const taskPath = path.join(root, ".trellis", "tasks", TASK, "task.json");
    const task = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
    task.status = "planning";
    task.meta.task_workflow.implementation_authorization.approval_ref = "  ";
    fs.writeFileSync(taskPath, `${JSON.stringify(task)}\n`);

    const start = runTask(root, "start", TASK);
    expect(start.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(taskPath, "utf-8")).status).toBe("planning");
  });

  it("keeps task status in planning when confirmed requirements change before start", () => {
    prepareImplementationContract(root);
    authorizeImplementation(root, "design.md");
    const taskPath = path.join(root, ".trellis", "tasks", TASK, "task.json");
    const task = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
    task.status = "planning";
    fs.writeFileSync(taskPath, `${JSON.stringify(task)}\n`);
    fs.appendFileSync(
      path.join(root, ".trellis", "tasks", TASK, "prd.md"),
      "\nChanged requirements.\n",
    );

    const start = runTask(root, "start", TASK);
    expect(start.status).toBe(0);
    expect(start.stderr).toContain("TASK_PHASE_STALE_ARTIFACT");
    expect(JSON.parse(fs.readFileSync(taskPath, "utf-8")).status).toBe("planning");
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
      [GOAL_EXPLORATION_AND_REQUIREMENTS, SOLUTION_DESIGN_AND_CONVERGENCE, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
      "--route-reason",
      "Decision and design phases are not needed for this bounded review",
      "--route-evidence-ref",
      "prd.md",
    );
    const goalRequirementsRevision = setArtifact(root, GOAL_EXPLORATION_AND_REQUIREMENTS);
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
    expect(prematureAccept.stderr).toContain("Solution Design and Convergence Phase must remain active");
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
    expect(readState(root).current_phase_id).toBe(SOLUTION_DESIGN_AND_CONVERGENCE);
    expect(readState(root).phases[SOLUTION_DESIGN_AND_CONVERGENCE].status).toBe("blocked");
    expect(readState(root).phases[SOLUTION_DESIGN_AND_CONVERGENCE].outcome_kind).toBe("deferred");
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
      [GOAL_EXPLORATION_AND_REQUIREMENTS, DECISION_SPACE_CONSTRUCTION_AND_MERGING, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
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

    const skipped = readState(root).phases[DECISION_SPACE_CONSTRUCTION_AND_MERGING];
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
      [GOAL_EXPLORATION_AND_REQUIREMENTS, TASK_IMPLEMENTATION, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
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

    const taskPath = path.join(root, ".trellis", "tasks", TASK, "task.json");
    const task = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
    task.status = "planning";
    fs.writeFileSync(taskPath, `${JSON.stringify(task)}\n`);
    runOk(root, "start", TASK);

    expect(JSON.parse(fs.readFileSync(taskPath, "utf-8")).status).toBe("in_progress");
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
      [GOAL_EXPLORATION_AND_REQUIREMENTS, DECISION_SPACE_CONSTRUCTION_AND_MERGING, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
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
      GOAL_EXPLORATION_AND_REQUIREMENTS,
      "--reason",
      "The confirmed requirement artifact changed",
      "--evidence-ref",
      "prd.md",
    );
    const revisedRevision = setArtifact(root, GOAL_EXPLORATION_AND_REQUIREMENTS);
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
    expect(readState(root).phases[GOAL_EXPLORATION_AND_REQUIREMENTS].acceptance.evidence_refs).toContain("user-message:requirements-v2");
  });

  it("completes an implementation-intent no-go without entering implementation", () => {
    const taskPath = path.join(root, ".trellis", "tasks", TASK, "task.json");
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
      [GOAL_EXPLORATION_AND_REQUIREMENTS, SOLUTION_DESIGN_AND_CONVERGENCE, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
      "--route-reason",
      "Decision Space Construction and Consolidation Phase and Task Implementation and Test Verification Phase are not needed for the no-go outcome",
      "--route-evidence-ref",
      "prd.md",
    );
    const goalRequirementsRevision = setArtifact(root, GOAL_EXPLORATION_AND_REQUIREMENTS);
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
    accept(root, SOLUTION_DESIGN_AND_CONVERGENCE, "no_go", ["--result-ref", "prd.md"]);
    const deliveryCloseoutRevision = setArtifact(root, DELIVERY_REVIEW_AND_CLOSEOUT);
    runOk(
      root,
      "phase",
      "accept",
      TASK,
      "--expected-route-revision",
      "1",
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
    expect(JSON.parse(fs.readFileSync(taskPath, "utf-8")).status).toBe("planning");
    runOk(root, "complete", TASK);
    const completedTask = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
    expect(completedTask.status).toBe("completed");
    expect(completedTask.meta.task_workflow.closeout_disposition).toBe("no_go");
  });

  it("requires confirmed Delivery Review and On-Site Closeout Phase before cancellation", () => {
    const childId = "10-31-cancel-child";
    const childDir = path.join(root, ".trellis", "tasks", childId);
    fs.mkdirSync(childDir, { recursive: true });
    const parentPath = path.join(root, ".trellis", "tasks", TASK, "task.json");
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
      [GOAL_EXPLORATION_AND_REQUIREMENTS, DECISION_SPACE_CONSTRUCTION_AND_MERGING, SOLUTION_DESIGN_AND_CONVERGENCE, TASK_IMPLEMENTATION, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
    );
    const goalRequirementsRevision = setArtifact(root, GOAL_EXPLORATION_AND_REQUIREMENTS);
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
      [GOAL_EXPLORATION_AND_REQUIREMENTS, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
      "--target-phase",
      DELIVERY_REVIEW_AND_CLOSEOUT,
      "--reason",
      "The user withdrew the task after requirements review",
      "--evidence-ref",
      "prd.md",
      "--evidence-ref",
      "user-message:task-withdrawn",
    );
    expect(readState(root).phase_ids).toEqual([GOAL_EXPLORATION_AND_REQUIREMENTS, DELIVERY_REVIEW_AND_CLOSEOUT]);
    expect(readState(root).return_record?.evidence_refs).toContain("user-message:task-withdrawn");
    const deliveryCloseoutRevision = setArtifact(root, DELIVERY_REVIEW_AND_CLOSEOUT);
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
    const childTask = JSON.parse(fs.readFileSync(path.join(childDir, "task.json"), "utf-8"));
    childTask.meta.delegated_worktree_execution_record = { agent_id: "agent-test-id" };
    fs.writeFileSync(path.join(childDir, "task.json"), `${JSON.stringify(childTask)}\n`);
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
    expect(cancelWithActiveAgent.stderr).toContain("TASK_PHASE_RESOURCE_ACTIVE");
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
      fs.readFileSync(path.join(root, ".trellis", "tasks", TASK, "task.json"), "utf-8"),
    );
    expect(task.status).toBe("cancelled");
    expect(task.meta.task_cancellation.reason).toBe("The proposed change is not needed");
    const unlink = runTask(root, "remove-subtask", TASK, childId);
    expect(unlink.status).toBe(1);
    expect(unlink.stderr).toContain("independently continuing");
    expect(JSON.parse(fs.readFileSync(path.join(childDir, "task.json"), "utf-8")).parent).toBe(TASK);
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
      [GOAL_EXPLORATION_AND_REQUIREMENTS, DECISION_SPACE_CONSTRUCTION_AND_MERGING, SOLUTION_DESIGN_AND_CONVERGENCE, TASK_IMPLEMENTATION, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
    );
    runOk(
      root,
      "phase",
      "route",
      TASK,
      "--expected-route-revision",
      "1",
      "--phase-ids",
      [GOAL_EXPLORATION_AND_REQUIREMENTS, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
      "--target-phase",
      DELIVERY_REVIEW_AND_CLOSEOUT,
      "--reason",
      "The user withdrew the task during requirements alignment",
      "--evidence-ref",
      "prd.md",
      "--evidence-ref",
      "user-message:task-withdrawn",
    );

    const state = readState(root);
    expect(state.current_phase_id).toBe(DELIVERY_REVIEW_AND_CLOSEOUT);
    expect(state.phases[GOAL_EXPLORATION_AND_REQUIREMENTS].status).toBe("skipped");
    expect(state.skip_records[GOAL_EXPLORATION_AND_REQUIREMENTS].reason).toMatch(/withdrew/);
    expect(state.return_record?.evidence_refs).toContain("user-message:task-withdrawn");
    expect(parseTaskWorkflowState(state)).toEqual(state);

    const deliveryCloseoutRevision = setArtifact(root, DELIVERY_REVIEW_AND_CLOSEOUT);
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
    const first = JSON.parse(runOkAs(root, "first-session", "continuity", "show"));
    expect(first.status).toBe("absent");
    const args = ["--task-id", TASK, "--task-path", `.trellis/tasks/${TASK}`, "--package-id", "package-a", "--package-digest", "a".repeat(64), "--expected-continuity-digest", first.source_digest, "--expected-generation", "0", "--explicit-user-request"];
    expect(JSON.parse(runOkAs(root, "first-session", "transfer", "quiesce", ...args)).status).toBe("quiescing");

    runOkAs(root, "second-session", "start", otherPath);
    const second = JSON.parse(runOkAs(root, "second-session", "continuity", "show"));
    expect(second.status).toBe("absent");
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
      "combined",
      "--complexity",
      "standard",
      "--project-context",
      "existing",
      "--phase-ids",
      [GOAL_EXPLORATION_AND_REQUIREMENTS, DECISION_SPACE_CONSTRUCTION_AND_MERGING, SOLUTION_DESIGN_AND_CONVERGENCE, TASK_IMPLEMENTATION, DELIVERY_REVIEW_AND_CLOSEOUT].join(","),
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
    const staleCapture = runTaskAs(root, "source-session", "transfer", "quiesce", "--task-id", TASK, "--task-path", `.trellis/tasks/${TASK}`, "--package-id", "package-1", "--package-digest", "a".repeat(64), "--expected-continuity-digest", captured.source_digest, "--expected-generation", "0", "--explicit-user-request");
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
    const currentDigest = JSON.parse(runOkAs(root, "source-session", "continuity", "show")).source_digest as string;
    const transfer = (session: string, action: string, generation: number) => runOkAs(
      root,
      session,
      "transfer",
      action,
      ...packageArgs,
      ...(action === "quiesce" ? ["--expected-continuity-digest", currentDigest] : []),
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
    const targetWriteBeforeConsume = runTaskAs(root, "target-session", "set-meta", TASK, "owner", "premature");
    expect(targetWriteBeforeConsume.status).toBe(1);
    expect(targetWriteBeforeConsume.stderr).toContain("TASK_TRANSFER_ACTIVE");

    const targetContextPath = path.join(root, ".trellis", ".runtime", "sessions", "target-session.json");
    const targetContext = fs.readFileSync(targetContextPath, "utf-8");
    fs.writeFileSync(targetContextPath, "{ not json");
    const failedTakeover = runTaskAs(root, "replacement-session", "transfer", "claim", ...packageArgs, "--expected-generation", "4", "--explicit-user-request");
    expect(failedTakeover.status).toBe(1);
    expect(failedTakeover.stdout).toContain("TASK_TRANSFER_RECOVERY_REQUIRED");
    expect(JSON.parse(transfer("replacement-session", "status", 4))).toMatchObject({ status: "claimed", generation: 4, target_session_id: "target-session" });
    fs.writeFileSync(targetContextPath, targetContext);

    const takeover = JSON.parse(transfer("replacement-session", "claim", 4));
    expect(takeover).toMatchObject({ status: "claimed", generation: 5, target_session_id: "replacement-session" });
    expect(JSON.parse(runTaskAs(root, "target-session", "current", "--json").stdout).current_task).toBeNull();
    const staleTargetClaim = runTaskAs(root, "target-session", "transfer", "claim", ...packageArgs, "--expected-generation", "4", "--explicit-user-request");
    expect(staleTargetClaim.status).toBe(1);
    expect(staleTargetClaim.stdout).toContain("TASK_TRANSFER_STALE_GENERATION");
    const previousTargetConsume = runTaskAs(root, "target-session", "transfer", "consume", ...packageArgs, "--expected-generation", "5", "--explicit-user-request");
    expect(previousTargetConsume.status).toBe(1);
    expect(previousTargetConsume.stdout).toContain("TASK_TRANSFER_WITHHELD");
    const replacementWriteBeforeConsume = runTaskAs(root, "replacement-session", "set-meta", TASK, "owner", "premature");
    expect(replacementWriteBeforeConsume.status).toBe(1);
    expect(replacementWriteBeforeConsume.stderr).toContain("TASK_TRANSFER_ACTIVE");
    expect(JSON.parse(transfer("replacement-session", "consume", 5)).status).toBe("consumed");
    expect(JSON.parse(runOkAs(root, "replacement-session", "current", "--json")).current_task.dir).toBe(`.trellis/tasks/${TASK}`);
    const sourceRestart = runTaskAs(root, "source-session", "start", TASK);
    expect(sourceRestart.status).toBe(1);
    const activeRename = runTaskAs(root, "replacement-session", "rename", TASK, "renamed-phase-workflow-test");
    expect(activeRename.status).toBe(1);
    expect(activeRename.stderr).toContain("TASK_TRANSFER_TASK_ID_LOCKED");
    runOkAs(root, "replacement-session", "set-meta", TASK, "owner", "replacement");

    const staleGeneration = runTaskAs(root, "replacement-session", "transfer", "consume", ...packageArgs, "--expected-generation", "5", "--explicit-user-request");
    expect(staleGeneration.status).toBe(1);
    expect(staleGeneration.stdout).toContain("TASK_TRANSFER_STALE_GENERATION");
  });
});
