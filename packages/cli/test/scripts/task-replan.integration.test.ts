import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEMPLATE_SCRIPTS = path.resolve(__dirname, "../../src/templates/trellis/scripts");
const SHELL_CONTEXT_HOOK = path.resolve(
  __dirname,
  "../../src/templates/shared-hooks/inject-shell-session-context.py",
);

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasPython())("task.py replan lifecycle", () => {
  let repo: string;
  const task = "10-21-replan-fixture";
  const decisions = `<!-- trellis-decisions:v1 -->\n\`\`\`json\n{"schema_version":1,"decisions":[{"id":"scope","status":"decided","question":"Which scope?","evidence":["prd.md#Scope"],"answer_or_reason":"Use the bounded scope","impact":"No expansion","reopen_when":"Owner changes"}]}\n\`\`\`\n`;
  const implementationPlan = `<!-- trellis-implementation-plan:v1 -->\n\`\`\`json\n{"schema_version":1,"steps":[{"id":"implement","target":{"repository":"fixture","branch":"main","component_or_path":"src"},"depends_on":[],"action":"Implement the approved bounded change","deliverables":"Verified change","verification":"Run focused integration tests","risks":"Regression","rollback":"Revert the change"}],"stop_point":{"condition":"Acceptance passes","observable_evidence":"Test command succeeds","remaining_work":"None within this task"}}\n\`\`\`\n`;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-replan-"));
    fs.mkdirSync(path.join(repo, ".trellis", "tasks", task), { recursive: true });
    fs.cpSync(TEMPLATE_SCRIPTS, path.join(repo, ".trellis", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".trellis", ".developer"), "name=tester\n");
    fs.writeFileSync(
      path.join(repo, ".trellis", "tasks", task, "task.json"),
      JSON.stringify({ id: task, name: task, title: "Replan fixture", status: "in_progress", branch: "pennix/v0.7-beta", meta: { execution_class: "planned", delivery_mode: "change_bearing" }, children: [] }) + "\n",
    );
    for (const name of ["prd.md", "design.md"]) {
      fs.writeFileSync(path.join(repo, ".trellis", "tasks", task, name), "# Approved fixture\n\nBounded test plan.\n");
    }
    fs.writeFileSync(path.join(repo, ".trellis", "tasks", task, "prd.md"), "# Scope\n\nBounded test plan.\n\n# Verification\n\nRun focused integration tests.\n\n# Rollback\n\nRevert the change.\n\n" + decisions);
    fs.writeFileSync(path.join(repo, ".trellis", "tasks", task, "implement.md"), implementationPlan);
    execFileSync("git", ["init", "-q", repo]);
  });

  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  function run(args: string[], withIdentity = true) {
    return spawnSync("python3", [".trellis/scripts/task.py", ...args], {
      cwd: repo,
      encoding: "utf-8",
      env: withIdentity
        ? { ...process.env, TRELLIS_CONTEXT_ID: "replan-test" }
        : { ...process.env, TRELLIS_CONTEXT_ID: undefined },
    });
  }

  function advanceToUserReview(directory = task, fromIntake = false) {
    if (fromIntake) {
      const evidence = run(["plan", "advance", directory, "--to", "evidence"]);
      expect(evidence.status, evidence.stderr).toBe(0);
      const formation = run(["plan", "advance", directory, "--to", "solution_formation"]);
      expect(formation.status, formation.stderr).toBe(0);
    }
    const review = run(["plan", "advance", directory, "--to", "solution_review"]);
    expect(review.status, review.stderr).toBe(0);
    const userReview = run(["plan", "advance", directory, "--to", "user_review"]);
    expect(userReview.status, userReview.stderr).toBe(0);
  }

  function sealAndApprove(directory = task) {
    const digest = JSON.parse(run(["plan", "digest", directory]).stdout).digest;
    expect(run(["plan", "seal", directory, "--expected-digest", digest]).status).toBe(0);
    const revision = JSON.parse(fs.readFileSync(path.join(repo, ".trellis", "tasks", directory, "task.json"), "utf-8")).meta.planning.revision;
    expect(run(["plan", "approve", directory, "--revision", String(revision), "--basis", "Explicit test approval after reviewing the complete plan"]).status).toBe(0);
  }

  it("records the reason and affected stage, then re-seals before restarting", () => {
    const replan = run(["replan", task, "--to", "solution_formation", "implementation", "needs", "a", "design", "decision"]);
    expect(replan.status, replan.stderr).toBe(0);

    const taskPath = path.join(repo, ".trellis", "tasks", task);
    const replanned = JSON.parse(fs.readFileSync(path.join(taskPath, "task.json"), "utf-8"));
    expect(replanned.status).toBe("planning");
    expect(replanned.meta.planning).toEqual({ revision: 2, stage: "solution_formation" });
    const event = JSON.parse(fs.readFileSync(path.join(taskPath, "replans.jsonl"), "utf-8"));
    expect(event.reason).toBe("implementation needs a design decision");
    expect(event.from_status).toBe("in_progress");
    expect(event.from_stage).toBeNull();
    expect(event.to_stage).toBe("solution_formation");
    expect(event.revision).toBe(2);
    expect(JSON.parse(fs.readFileSync(path.join(taskPath, "task.json"), "utf-8")).branch).toBe("pennix/v0.7-beta");

    expect(run(["start", task, "--allow-empty-context"]).status).toBe(1);
    advanceToUserReview();
    sealAndApprove();
    const start = run(["start", task, "--allow-empty-context"]);
    expect(start.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(taskPath, "task.json"), "utf-8")).status).toBe("in_progress");
  });

  it("keeps read-only analysis tasks in planning while allowing context selection", () => {
    const directory = path.join(repo, ".trellis", "tasks", "analysis-only");
    fs.mkdirSync(directory);
    const taskJson = path.join(directory, "task.json");
    fs.writeFileSync(
      taskJson,
      JSON.stringify({ id: "analysis-only", name: "analysis-only", status: "planning", branch: null, meta: { execution_class: "direct", delivery_mode: "analysis_only" }, children: [] }) + "\n",
    );
    const before = fs.readFileSync(taskJson, "utf-8");
    const start = run(["start", "analysis-only", "--allow-empty-context"]);
    expect(start.status).toBe(1);
    expect(start.stderr).toContain("analysis_only tasks remain in planning");
    expect(fs.readFileSync(taskJson, "utf-8")).toBe(before);
    expect(run(["select", "analysis-only"]).status).toBe(0);
    expect(fs.readFileSync(taskJson, "utf-8")).toBe(before);
  });

  it("lists replan in the task help output", () => {
    const help = run([]);
    expect(help.status).toBe(1);
    expect(help.stdout).toContain(
      'python3 task.py replan <dir> --to <stage> "<reason>" Return task to its earliest affected planning stage',
    );
  });

  it("selects planning context without starting, gates current task/revision, and invalidates on replan", () => {
    const directory = path.join(repo, ".trellis", "tasks", task);
    const taskJson = path.join(directory, "task.json");
    const read = () => JSON.parse(fs.readFileSync(taskJson, "utf-8"));
    fs.writeFileSync(taskJson, JSON.stringify({ ...read(), status: "planning", branch: null }) + "\n");
    const before = fs.readFileSync(taskJson, "utf-8");
    expect(run(["select", task]).status).toBe(0);
    expect(fs.readFileSync(taskJson, "utf-8")).toBe(before);
    expect(run(["start", task, "--allow-empty-context"]).status).toBe(1);
    expect(fs.readFileSync(taskJson, "utf-8")).toBe(before);
    advanceToUserReview(task, true);
    const digest = JSON.parse(run(["plan", "digest", task]).stdout).digest;
    expect(run(["plan", "seal", task, "--expected-digest", digest]).status).toBe(0);
    expect(run(["plan", "approve", task, "--revision", "2", "--basis", "Wrong version"]).status).toBe(1);
    expect(run(["start", task, "--allow-empty-context"]).status).toBe(1);
    expect(run(["plan", "approve", task, "--revision", "1", "--basis", "User explicitly approved final material plan 1"]).status).toBe(0);
    // Progress text is not a new material plan and does not demand reapproval.
    fs.appendFileSync(path.join(directory, "execution.md"), "\nProgress: checks started.\n");
    const approved = read();
    const other = path.join(repo, ".trellis", "tasks", "other-task");
    fs.mkdirSync(other);
    for (const name of ["prd.md", "design.md", "implement.md"]) fs.copyFileSync(path.join(directory, name), path.join(other, name));
    fs.writeFileSync(path.join(other, "task.json"), JSON.stringify({ ...approved, id: "other-task", name: "other-task" }) + "\n");
    expect(run(["start", "other-task", "--allow-empty-context"]).status).toBe(1);
    expect(JSON.parse(run(["current", "--json"]).stdout).current_task.dir).toBe(`.trellis/tasks/${task}`);
    expect(run(["start", task, "--allow-empty-context"]).status).toBe(0);
    expect(run(["replan", task, "--to", "intake", "Material owner change"]).status).toBe(0);
    expect(read().meta.planning).toEqual({ revision: 2, stage: "intake" });
    expect(run(["start", task, "--allow-empty-context"]).status).toBe(1);
    expect(run(["select", "missing-task"]).status).toBe(1);
    fs.mkdirSync(path.join(repo, ".trellis", "tasks", "archive"));
    fs.renameSync(other, path.join(repo, ".trellis", "tasks", "archive", "other-task"));
    expect(run(["select", ".trellis/tasks/archive/other-task"]).status).toBe(1);
  });

  it.each(["prd.md", "design.md", "implement.md"])("rejects changed sealed content in %s before approve or start", (document) => {
    const directory = path.join(repo, ".trellis", "tasks", task);
    const taskJson = path.join(directory, "task.json");
    const data = JSON.parse(fs.readFileSync(taskJson, "utf-8"));
    fs.writeFileSync(taskJson, JSON.stringify({ ...data, status: "planning" }) + "\n");
    advanceToUserReview(task, true);
    const digest = JSON.parse(run(["plan", "digest", task]).stdout).digest;
    expect(run(["plan", "seal", task, "--expected-digest", digest]).status).toBe(0);
    expect(run(["plan", "approve", task, "--revision", "1", "--basis", "Explicit test approval"]).status).toBe(0);
    const before = fs.readFileSync(taskJson, "utf-8");
    fs.appendFileSync(path.join(directory, document), "\nChanged scope.\n");
    for (const args of [["plan", "approve", task, "--revision", "1", "--basis", "Old approval"], ["start", task, "--allow-empty-context"]]) {
      const result = run(args);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("sealed plan content changed");
      expect(fs.readFileSync(taskJson, "utf-8")).toBe(before);
    }
    expect(run(["replan", task, "--to", "solution_formation", "sealed material changed"]).status).toBe(0);
    advanceToUserReview();
    sealAndApprove();
    expect(run(["start", task, "--allow-empty-context"]).status).toBe(0);
  });

  it("rejects invalid preconditions without changing task state", () => {
    const taskPath = path.join(repo, ".trellis", "tasks", task);
    for (const args of [
      ["replan", "missing-task", "--to", "intake", "reason"],
      ["replan", task, "--to", "intake", "   "],
    ]) {
      expect(run(args).status).toBe(1);
      expect(JSON.parse(fs.readFileSync(path.join(taskPath, "task.json"), "utf-8")).status).toBe("in_progress");
      expect(fs.existsSync(path.join(taskPath, "replans.jsonl"))).toBe(false);
    }

    fs.writeFileSync(
      path.join(taskPath, "task.json"),
      JSON.stringify({ id: task, name: task, status: "planning", meta: {}, children: [] }) + "\n",
    );
    expect(run(["replan", task, "--to", "intake", "reason"]).status).toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(taskPath, "task.json"), "utf-8")).status).toBe("planning");
    expect(fs.existsSync(path.join(taskPath, "replans.jsonl"))).toBe(false);
  });

  it("does not change task state when the replan event cannot be written", () => {
    const taskPath = path.join(repo, ".trellis", "tasks", task);
    fs.mkdirSync(path.join(taskPath, "replans.jsonl"));
    expect(run(["replan", task, "--to", "intake", "reason"]).status).toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(taskPath, "task.json"), "utf-8")).status).toBe("in_progress");
  });

  it("uses the shell-session ticket when replan has no native environment identity", () => {
    const hookDirectory = path.join(repo, ".cursor", "hooks");
    fs.mkdirSync(hookDirectory, { recursive: true });
    const hook = path.join(hookDirectory, "inject-shell-session-context.py");
    fs.copyFileSync(SHELL_CONTEXT_HOOK, hook);
    const ticket = spawnSync("python3", [hook], {
      cwd: repo,
      encoding: "utf-8",
      input: JSON.stringify({
        conversation_id: "replan-ticket",
        cwd: repo,
        command: `.trellis/scripts/task.py replan ${task} --to solution_formation decision-needed && echo password=SYNTHETIC_CANARY`,
      }),
    });
    expect(ticket.status, ticket.stderr).toBe(0);
    const tickets = path.join(repo, ".trellis", ".runtime", "shell-tickets");
    const [ticketName] = fs.readdirSync(tickets);
    const contents = fs.readFileSync(path.join(tickets, ticketName), "utf-8");
    expect(contents).not.toContain("SYNTHETIC_CANARY");
    expect(JSON.parse(contents)).not.toHaveProperty("command");
    expect(JSON.parse(contents)).not.toHaveProperty("host_cwd");

    const replan = run(["replan", task, "--to", "solution_formation", "decision-needed"], false);
    expect(replan.status, replan.stderr).toBe(0);
    const event = JSON.parse(
      fs.readFileSync(path.join(repo, ".trellis", "tasks", task, "replans.jsonl"), "utf-8"),
    );
    expect(event.session).toBeTruthy();
  });

  it("replans a sealed planning revision and rejects terminal tasks", () => {
    const taskPath = path.join(repo, ".trellis", "tasks", task);
    const taskJson = path.join(taskPath, "task.json");
    const sealed = JSON.parse(fs.readFileSync(taskJson, "utf-8"));
    sealed.status = "planning";
    sealed.meta.planning = { revision: 4, stage: "plan_closed", approved_revision: 4, approval_basis: "old approval", seal: { revision: 4 } };
    fs.writeFileSync(taskJson, JSON.stringify(sealed) + "\n");

    const result = run(["replan", task, "--to", "decision_convergence", "new evidence changes a decision"]);
    expect(result.status, result.stderr).toBe(0);
    const replanned = JSON.parse(fs.readFileSync(taskJson, "utf-8"));
    expect(replanned.status).toBe("planning");
    expect(replanned.meta.planning).toEqual({ revision: 5, stage: "decision_convergence" });
    const event = JSON.parse(fs.readFileSync(path.join(taskPath, "replans.jsonl"), "utf-8"));
    expect(event.from_status).toBe("planning");
    expect(event.from_stage).toBe("plan_closed");
    expect(event.to_stage).toBe("decision_convergence");
    expect(event.revision).toBe(5);

    replanned.status = "completed";
    fs.writeFileSync(taskJson, JSON.stringify(replanned) + "\n");
    const terminal = run(["replan", task, "--to", "intake", "follow-up work"]);
    expect(terminal.status).toBe(1);
    expect(terminal.stderr).toContain("target task must be planning or in_progress");
    expect(fs.readFileSync(path.join(taskPath, "replans.jsonl"), "utf-8").trim().split("\n")).toHaveLength(1);

    const archive = path.join(repo, ".trellis", "tasks", "archive", "2026-10", task);
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.renameSync(taskPath, archive);
    const archived = run(["replan", `.trellis/tasks/archive/2026-10/${task}`, "--to", "intake", "follow-up work"]);
    expect(archived.status).toBe(1);
    expect(archived.stderr).toContain("target must be a direct active task directory");
  });
});
