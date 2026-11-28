import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const templates = path.resolve(__dirname, "../../src/templates");
const taskRef = ".trellis/tasks/planning/11-28-turn-fixture";

describe("native Codex turn evidence", () => {
  let root: string;
  let call: number;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-turn-"));
    call = 0;
    fs.mkdirSync(path.join(root, ".trellis"), { recursive: true });
    fs.cpSync(path.join(templates, "trellis/scripts"), path.join(root, ".trellis/scripts"), { recursive: true });
    fs.mkdirSync(path.join(root, ".codex/hooks"), { recursive: true });
    for (const [source, name] of [
      ["codex/hooks/turn-guard.py", "turn-guard.py"],
      ["shared-hooks/inject-shell-session-context.py", "inject-shell-session-context.py"],
    ]) {
      fs.copyFileSync(path.join(templates, source), path.join(root, ".codex/hooks", name));
    }
    env = { ...process.env, HOME: root, TRELLIS_CONTEXT_ID: "", CODEX_THREAD_ID: "",
      DSH_TRELLIS_CONTEXT_ID: "", DSH_SESSION_ID: "", TRELLIS_HOOKS: "1",
      TRELLIS_DISABLE_HOOKS: "0" };
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function hook(name: string, extra: Record<string, unknown> = {}) {
    const file = name === "PreToolUse" && extra.tool_name !== "request_user_input"
      ? "inject-shell-session-context.py" : "turn-guard.py";
    const result = spawnSync("python3", [path.join(root, ".codex/hooks", file)], {
      cwd: root, env, encoding: "utf-8",
      input: JSON.stringify({ hook_event_name: name, cwd: root,
        session_id: "source", turn_id: "turn-1", ...extra }),
    });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout ? JSON.parse(result.stdout) : {};
  }

  function start(extra: Record<string, unknown> = {}) {
    return hook("UserPromptSubmit", { prompt: "Inspect this synthetic fixture.", ...extra });
  }

  function task(...args: string[]) {
    return spawnSync("python3", [".trellis/scripts/task.py", ...args], {
      cwd: root, env: { ...env, TRELLIS_CONTEXT_ID: "codex_source" }, encoding: "utf-8",
    });
  }

  function taskOk(...args: string[]) {
    const result = task(...args);
    expect(result.status, result.stderr + result.stdout).toBe(0);
    return result.stdout;
  }

  function rewrite(command: string, extra: Record<string, unknown> = {}) {
    return hook("PreToolUse", { tool_name: "Bash", tool_use_id: `call-${++call}`,
      tool_input: { command }, ...extra });
  }

  function record(args = "--kind bounded_reply --scope inspection --evidence-ref fixture:inspection") {
    const result = rewrite("python3 .trellis/scripts/task.py turn record " + args);
    const output = result.hookSpecificOutput;
    expect(output.permissionDecision, JSON.stringify(output)).toBe("allow");
    expect(output.hookEventName).toBe("PreToolUse");
    const executed = spawnSync("bash", ["-c", output.updatedInput.command], {
      cwd: root, env, encoding: "utf-8",
    });
    return { ...executed, command: output.updatedInput.command as string };
  }

  it("binds an explicit user-stop instruction to the actual current human prompt", () => {
    start();
    expect(record("--kind user_stop --user-instruction 'Stop now.' --evidence-ref fixture:user-stop").status).not.toBe(0);
    expect(hook("Stop").decision).toBe("block");
    start({ prompt: "Stop now." });
    expect(record("--kind user_stop --user-instruction 'Stop now.' --evidence-ref fixture:user-stop").status).toBe(0);
    expect(hook("Stop").decision).toBeUndefined();
  });

  function session(sessionId = "source") {
    return path.join(root, `.trellis/.runtime/sessions/codex_${sessionId}.json`);
  }

  function bindTask() {
    const dir = path.join(root, taskRef);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "task.json"), JSON.stringify({
      id: "turn-fixture", name: "11-28-turn-fixture", status: "planning", meta: {},
    }));
    fs.writeFileSync(path.join(dir, "prd.md"), "# Synthetic requirements\n");
    taskOk("phase", "init", taskRef, "--task-kind", "analysis", "--complexity", "simple",
      "--project-context", "existing", "--phase-ids",
      "goal_exploration_and_requirements,delivery_review_and_closeout",
      "--route-reason", "Bounded fixture", "--route-evidence-ref", "prd.md");
    taskOk("start", taskRef);
  }

  it("rewrites only command, consumes one exact invocation and preserves taskless state", () => {
    start();
    const result = record();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe("recorded");
    expect(hook("Stop", { last_assistant_message: "Inspection complete." })).toEqual({});
    const replay = spawnSync("bash", ["-c", result.command], { cwd: root, env, encoding: "utf-8" });
    expect(replay.status).toBe(1);
    expect(replay.stderr).toContain("replayed");
    expect(JSON.parse(fs.readFileSync(session(), "utf-8")).current_task).toBeUndefined();
  });

  it("does not grant an exit on an unticketed or changed command", () => {
    start();
    expect(task("turn", "record", "--kind", "bounded_reply", "--scope", "inspection",
      "--evidence-ref", "fixture:inspection").status).toBe(1);
    const output = rewrite("python3 .trellis/scripts/task.py turn record --kind bounded_reply --scope inspection --evidence-ref fixture:inspection");
    const changed = output.hookSpecificOutput.updatedInput.command.replace("--scope inspection", "--scope explanation");
    const result = spawnSync("bash", ["-c", changed], { cwd: root, env, encoding: "utf-8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mismatched");
    expect(hook("Stop").decision).toBe("block");
  });

  it("keeps input rewriting idempotent for one actual call and preserves other hook input fields", () => {
    start();
    const event = { tool_use_id: "one-call", tool_input: {
      command: "python3 -X utf8 .trellis/scripts/task.py turn show",
      description: "Preserve this selector metadata",
    } };
    const first = rewrite(event.tool_input.command, event);
    const input = first.hookSpecificOutput.updatedInput;
    expect(input.description).toBe(event.tool_input.description);
    expect(rewrite(input.command, { ...event, tool_input: input })).toEqual(first);
    expect(rewrite(input.command, { ...event, tool_input: input, tool_use_id: "other-call" })
      .hookSpecificOutput.permissionDecision).toBe("deny");
    expect(first.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it.each(["; true", " | cat", " &", " $(true)", "\ntrue"])(
    "rejects compound or expanding shell input %s without issuing evidence", (suffix) => {
      start();
      const result = rewrite("python3 .trellis/scripts/task.py turn show" + suffix);
      expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(hook("Stop").decision).toBe("block");
    },
  );

  it("rejects expired tickets, conflicting identities and a delayed old turn", () => {
    start();
    const output = rewrite("python3 .trellis/scripts/task.py turn show");
    const command = output.hookSpecificOutput.updatedInput.command as string;
    const id = command.split(" ").at(-1);
    const ticketPath = path.join(root, `.trellis/.runtime/shell-tickets/turn-${id}.json`);
    const ticket = JSON.parse(fs.readFileSync(ticketPath, "utf-8"));
    ticket.expires_at_epoch = 0;
    fs.writeFileSync(ticketPath, JSON.stringify(ticket));
    let result = spawnSync("bash", ["-c", command], { cwd: root, env, encoding: "utf-8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expired");
    const next = rewrite("python3 .trellis/scripts/task.py turn show").hookSpecificOutput.updatedInput.command;
    result = spawnSync("bash", ["-c", next], {
      cwd: root, env: { ...env, CODEX_THREAD_ID: "other" }, encoding: "utf-8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("disagree");
    start({ turn_id: "turn-2", prompt: "A real new user request." });
    result = spawnSync("bash", ["-c", next], { cwd: root, env, encoding: "utf-8" });
    expect(result.status).toBe(1);
    expect(hook("Stop", { turn_id: "turn-2" }).decision).toBe("block");
  });

  it("rechecks native task and artifact revisions before consuming a ticket", () => {
    start();
    bindTask();
    const output = rewrite("python3 .trellis/scripts/task.py turn record --kind bounded_reply --scope inspection --evidence-ref fixture:inspection");
    const taskPath = path.join(root, taskRef, "task.json");
    const data = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
    data.title = "Changed after PreToolUse";
    fs.writeFileSync(taskPath, JSON.stringify(data));
    const result = spawnSync("bash", ["-c", output.hookSpecificOutput.updatedInput.command], {
      cwd: root, env, encoding: "utf-8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("revision changed");
    expect(record("--kind task_complete --evidence-ref fixture:local-pass").status).toBe(1);
    taskOk("phase", "artifact", taskRef, "--expected-route-revision", "1", "--artifact-ref", "prd.md");
    const bound = rewrite("python3 .trellis/scripts/task.py turn show").hookSpecificOutput.updatedInput.command;
    fs.appendFileSync(path.join(root, taskRef, "prd.md"), "Changed actual artifact\n");
    const staleArtifact = spawnSync("bash", ["-c", bound], { cwd: root, env, encoding: "utf-8" });
    expect(staleArtifact.status).toBe(1);
    expect(staleArtifact.stderr).toContain("revision changed");
  });

  it("waits only with native phase evidence and an explicit question in the final message", () => {
    start();
    bindTask();
    const args = "--kind waiting_authorization --evidence-ref prd.md --no-independent-work --question 'Approve this fixture baseline?'";
    expect(record(args).status).toBe(1);
    taskOk("phase", "wait", taskRef, "--expected-route-revision", "1",
      "--reason", "Synthetic baseline approval", "--evidence-ref", "prd.md");
    expect(record(args).status).toBe(0);
    expect(hook("Stop", { last_assistant_message: "I am waiting for confirmation." }).decision).toBe("block");
    expect(hook("Stop", { last_assistant_message: "Approve this fixture baseline?" })).toEqual({});
    const runtime = fs.readFileSync(session(), "utf-8");
    expect(runtime).not.toContain("Approve this fixture baseline?");
    expect(runtime).not.toContain("Inspect this synthetic fixture.");
  });

  it("deduplicates real answers, invalidates waits and never treats empty answers as complete", () => {
    start();
    expect(record().status).toBe(0);
    const response = { tool_name: "request_user_input", tool_use_id: "question-1",
      tool_input: { questions: [{ id: "choice", header: "Choice", question: "Choose?" }] },
      tool_response: JSON.stringify({ answers: { choice: { answers: ["Second"] } } }) };
    hook("PreToolUse", response);
    const output = hook("PostToolUse", response);
    expect(output.hookSpecificOutput.additionalContext).toContain("real answer");
    expect(hook("PostToolUse", response)).toEqual({});
    let state = JSON.parse(fs.readFileSync(session(), "utf-8")).turn;
    expect(state.evidence).toBeNull();
    expect(state.answers["question-1"].status).toBe("complete");
    expect(record().status).toBe(0);
    hook("PostToolUse", response);
    expect(hook("Stop")).toEqual({});
    const empty = { ...response, tool_use_id: "question-2", tool_response: "{}" };
    hook("PreToolUse", empty);
    hook("PostToolUse", empty);
    state = JSON.parse(fs.readFileSync(session(), "utf-8")).turn;
    expect(state.answers["question-2"].status).toBe("incomplete");
    expect(state.evidence).toBeNull();
    expect(fs.readFileSync(session(), "utf-8")).not.toContain("Second");
  });

  it("invalidates evidence before a question so cancellation without PostToolUse cannot retain an old exit", () => {
    start();
    expect(record().status).toBe(0);
    hook("PreToolUse", { tool_name: "request_user_input", tool_use_id: "cancelled",
      tool_input: { questions: [{ id: "choice", question: "Choose?" }] } });
    const state = JSON.parse(fs.readFileSync(session(), "utf-8")).turn;
    expect(state.answers.cancelled.status).toBe("pending");
    expect(state.evidence).toBeNull();
    expect(hook("Stop").decision).toBe("block");
  });

  it.each([
    { answers: {} },
    { answers: { first: { answers: ["First"] } } },
    { answers: { first: { answers: [""] }, second: { answers: ["Second"] } } },
    { answers: { first: { answers: ["First"] }, other: { answers: ["Second"] } } },
  ])("does not consume partial, empty or mismatched native answers", (response) => {
    start();
    const event = { tool_name: "request_user_input", tool_use_id: "questions",
      tool_input: { questions: [{ id: "first", question: "First?" }, { id: "second", question: "Second?" }] },
      tool_response: response };
    hook("PreToolUse", event);
    hook("PostToolUse", event);
    expect(JSON.parse(fs.readFileSync(session(), "utf-8")).turn.answers.questions.status).toBe("incomplete");
  });

  it("withholds unsolicited and conflicting answer receipts instead of silently replacing decisions", () => {
    start();
    const event = { tool_name: "request_user_input", tool_use_id: "question",
      tool_input: { questions: [{ id: "choice", question: "Choose?" }] },
      tool_response: { answers: { choice: { answers: ["First"] } } } };
    expect(hook("PostToolUse", event).systemMessage).toContain("PROTECTION_FAILED");
    hook("PreToolUse", event);
    hook("PostToolUse", event);
    expect(record().status).toBe(0);
    const conflict = { ...event, tool_response: { answers: { choice: { answers: ["Second"] } } } };
    expect(hook("PostToolUse", conflict).systemMessage).toContain("PROTECTION_FAILED");
    expect(hook("Stop").decision).toBe("block");
  });

  it("preserves the current correction count on a repeated prompt/compaction and resets only for actual new input", () => {
    start();
    hook("Stop");
    start();
    expect(JSON.parse(fs.readFileSync(session(), "utf-8")).turn.corrections).toBe(1);
    start({ turn_id: "turn-new", prompt: "New real user input." });
    expect(JSON.parse(fs.readFileSync(session(), "utf-8")).turn.corrections).toBe(0);
    expect(JSON.parse(fs.readFileSync(session(), "utf-8")).turn.evidence).toBeNull();
  });

  it("caps correction in the native turn without trusting stop_hook_active as a success signal", () => {
    start();
    const first = hook("Stop");
    expect(first.decision).toBe("block");
    const second = hook("Stop", { stop_hook_active: true });
    expect(second.decision).toBe("block");
    const final = hook("Stop", { stop_hook_active: true });
    expect(final.continue).toBe(false);
    expect(final.systemMessage).toContain("PROTECTION_FAILED");
    expect(final.decision).toBeUndefined();
  });

  it("preserves interruption and exposes corrupt/missing-identity protection failures", () => {
    start();
    hook("Interrupt");
    expect(hook("Stop").continue).toBe(false);
    expect(rewrite("python3 .trellis/scripts/task.py turn show").hookSpecificOutput.permissionDecision).toBe("deny");
    fs.writeFileSync(session(), "broken");
    const failed = hook("Stop");
    expect(failed.continue).toBe(false);
    expect(failed.systemMessage).toContain("PROTECTION_FAILED");
    expect(fs.readFileSync(session(), "utf-8")).toBe("broken");
    expect(hook("Stop", { turn_id: null }).continue).toBe(false);
  });

  it("keeps windows isolated and preserves turn fields through native pointer changes", () => {
    start();
    bindTask();
    const before = JSON.parse(fs.readFileSync(session(), "utf-8")).turn;
    taskOk("finish");
    expect(JSON.parse(fs.readFileSync(session(), "utf-8")).turn).toEqual(before);
    start({ session_id: "other" });
    expect(record().status).toBe(0);
    expect(hook("Stop", { session_id: "other" }).decision).toBe("block");
    expect(hook("Stop")).toEqual({});
    expect(JSON.parse(fs.readFileSync(session("other"), "utf-8")).turn.evidence).toBeNull();
  });

  it("does not overwrite main-session state from native subagent hook events", () => {
    start();
    const before = fs.readFileSync(session(), "utf-8");
    expect(start({ agent_id: "child", prompt: "Subagent package", turn_id: "child-turn" })).toEqual({});
    expect(hook("Stop", { agent_id: "child", turn_id: "child-turn" })).toEqual({});
    expect(hook("PostToolUse", { agent_id: "child", turn_id: "child-turn" })).toEqual({});
    expect(rewrite("python3 .trellis/scripts/task.py turn show", { agent_id: "child" })).toEqual({});
    expect(fs.readFileSync(session(), "utf-8")).toBe(before);
  });

  it("invalidates an issued exit after native task relocation without dropping the current turn", () => {
    start();
    bindTask();
    expect(record().status).toBe(0);
    const before = JSON.parse(fs.readFileSync(session(), "utf-8")).turn.turn_id;
    taskOk("rename", taskRef, "turn-fixture-renamed");
    expect(JSON.parse(fs.readFileSync(session(), "utf-8")).turn.turn_id).toBe(before);
    expect(hook("Stop").decision).toBe("block");
    expect(record().status).toBe(0);
    expect(hook("Stop")).toEqual({});
  });

  it("records native completion after complete clears the task pointer and relocates task evidence", () => {
    start();
    bindTask();
    for (const outcome of ["accepted", "delivery_ready"]) {
      const revision = JSON.parse(taskOk("phase", "artifact", taskRef,
        "--expected-route-revision", "1", "--artifact-ref", "prd.md")).artifact_revision;
      taskOk("phase", "accept", taskRef, "--expected-route-revision", "1",
        "--artifact-revision", revision, "--result-ref", "prd.md",
        "--outcome-kind", outcome, "--evidence-ref", "fixture:actual-acceptance",
        ...(outcome === "delivery_ready" ? ["--closeout-disposition", "delivery_ready"] : []));
    }
    expect(record("--kind task_complete --evidence-ref prd.md").status).toBe(0);
    taskOk("complete", taskRef);
    expect(JSON.parse(fs.readFileSync(session(), "utf-8")).turn.turn_id).toBe("turn-1");
    expect(hook("Stop").decision).toBe("block");
    expect(record("--kind task_complete --evidence-ref prd.md").status).toBe(0);
    expect(hook("Stop")).toEqual({});
  });
});
