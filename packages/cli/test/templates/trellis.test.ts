import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  scriptsInit,
  commonInit,
  commonPaths,
  commonDeveloper,
  commonGitContext,
  commonTaskQueue,
  commonTaskUtils,
  commonTaskWorkflow,
  commonTaskContinuity,
  commonActiveTask,
  commonCliAdapter,
  getDeveloperScript,
  initDeveloperScript,
  taskScript,
  getContextScript,
  addSessionScript,
  workflowMdTemplate,
  gitignoreTemplate,
  getAllScripts,
  getAllAgents,
  teammateAgentTemplate,
  configYamlTemplate,
} from "../../src/templates/trellis/index.js";

// =============================================================================
// Template Constants — module-level string exports
// =============================================================================

describe("trellis template constants", () => {
  const allTemplates = {
    scriptsInit,
    commonInit,
    commonPaths,
    commonDeveloper,
    commonGitContext,
    commonTaskQueue,
    commonTaskUtils,
    commonTaskWorkflow,
    commonTaskContinuity,
    commonActiveTask,
    commonCliAdapter,
    getDeveloperScript,
    initDeveloperScript,
    taskScript,
    getContextScript,
    addSessionScript,
    workflowMdTemplate,
    gitignoreTemplate,
  };

  function workflowStateBreadcrumb(status: string): string {
    const match = new RegExp(
      `\\[workflow-state:${status}\\]([\\s\\S]*?)\\[/workflow-state:${status}\\]`,
    ).exec(workflowMdTemplate);
    if (!match) {
      throw new Error(`${status} breadcrumb block must exist in workflow.md`);
    }
    return match[1];
  }

  function stepSection(step: string): string {
    const pattern = new RegExp(
      `#### ${step.replace(".", "\\.")}[^\\n]*\\n([\\s\\S]*?)(?=\\n#### |\\n### |$)`,
    );
    const match = pattern.exec(workflowMdTemplate);
    if (!match) {
      throw new Error(`workflow.md step ${step} must exist`);
    }
    return match[1];
  }

  it("all templates are non-empty strings", () => {
    for (const [name, content] of Object.entries(allTemplates)) {
      expect(content.length, `${name} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it("Python scripts contain valid Python syntax indicators", () => {
    // scriptsInit (__init__.py) only has docstrings, so use scripts with actual code
    const pyScripts = [
      commonInit,
      commonPaths,
      commonActiveTask,
      getDeveloperScript,
      taskScript,
    ];
    for (const script of pyScripts) {
      expect(
        script.includes("import") ||
          script.includes("def ") ||
          script.includes("class ") ||
          script.includes("#"),
      ).toBe(true);
    }
  });

  it("scriptsInit is a Python docstring module", () => {
    expect(scriptsInit).toContain('"""');
  });

  it("workflowMdTemplate is markdown", () => {
    expect(workflowMdTemplate).toContain("#");
  });

  it("workflow index keeps the five phase Skills and transitions distinct", () => {
    for (const phase of [
      "goal_exploration_and_requirements",
      "decision_space_construction_and_merging",
      "solution_design_and_convergence",
      "task_implementation",
      "delivery_review_and_closeout",
    ]) {
      expect(workflowMdTemplate).toContain(`\`${phase}\``);
    }
    expect(workflowMdTemplate).toContain("当前基线已获用户确认");
    expect(workflowMdTemplate).toContain("实施合同已授权");
    expect(workflowMdTemplate).toContain("会话交接");
    expect(workflowMdTemplate).not.toContain("phase model");
  });

  it("phase entries preserve confirmation, conditional decision trees, and closeout", () => {
    expect(stepSection("1.1")).toContain("当前资产 revision 的用户明确确认");
    expect(stepSection("2.1")).toContain("读取阶段 2 Skill");
    const phase2Workflow = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/templates/common/bundled-skills/trellis-decision-space-construction-and-merging/workflow.md",
      ),
      "utf-8",
    );
    expect(phase2Workflow).toContain("仅当选择之间存在条件依赖时使用决策树");
    expect(phase2Workflow).toContain("prior-art review");
    expect(stepSection("3.1")).toContain("解决必要的用户决定");
    expect(stepSection("4.1")).toContain("只有明确授权委派 Git worktree 写入时才使用 Paseo");
    expect(stepSection("5.2")).toContain("正式会话交接仍是独立操作");
  });

  it("[codex-native-subagents] template mode helpers default to auto and fail invalid values closed to inline", () => {
    const scripts = getAllScripts();
    const config = scripts.get("common/config.py") ?? "";
    const workflowPhase = scripts.get("common/workflow_phase.py") ?? "";
    const taskStore = scripts.get("common/task_store.py") ?? "";

    expect(config).toContain('DEFAULT_CODEX_DISPATCH_MODE = "auto"');
    expect(config).toContain('if mode == "sub-agent":');
    expect(config).toContain('return "auto"');
    expect(config).toContain("using inline");
    expect(workflowPhase).toContain('mode = "auto"');
    expect(workflowPhase).toContain(
      'return "codex-sub-agent" if mode == "auto" else "codex-inline"',
    );
    expect(taskStore).toContain('get_codex_dispatch_mode(repo_root) == "auto"');
  });

  it("workflow.md stage 1 provides the requirements baseline", () => {
    const step = stepSection("1.1");
    expect(step).toContain("仅收集可能改变目标、范围");
    expect(step).toContain("用户明确确认");
    expect(step).toContain("当前资产 revision");
  });

  it("workflow.md planning breadcrumb requires a route before implementation", () => {
    const planning = workflowStateBreadcrumb("planning");
    const planningInline = workflowStateBreadcrumb("planning-inline");
    expect(planning).toContain("task.py phase init");
    expect(planning).toContain("实施授权");
    expect(planningInline).toContain("planning");
    expect(planningInline).toContain("主会话");
  });

  it("workflow.md task_error breadcrumb repairs the current task record", () => {
    const taskError = workflowStateBreadcrumb("task_error");
    expect(taskError).toContain("活动任务记录无法读取");
    expect(taskError).toContain("依据现有任务资产修复该记录");
  });

  it("gitignoreTemplate contains ignore patterns", () => {
    expect(gitignoreTemplate).toContain(".developer");
    expect(gitignoreTemplate).toContain("__pycache__");
    expect(gitignoreTemplate).toContain(".task-phase.lock");
  });
});

// =============================================================================
// getAllScripts — pure function assembling pre-loaded strings
// =============================================================================

describe("getAllScripts", () => {
  it("returns a Map", () => {
    const scripts = getAllScripts();
    expect(scripts).toBeInstanceOf(Map);
  });

  it("contains expected script entries", () => {
    const scripts = getAllScripts();
    expect(scripts.has("__init__.py")).toBe(true);
    expect(scripts.has("common/__init__.py")).toBe(true);
    expect(scripts.has("common/paths.py")).toBe(true);
    expect(scripts.has("common/active_task.py")).toBe(true);
    expect(scripts.has("common/task_workflow.py")).toBe(true);
    expect(scripts.has("common/task_continuity.py")).toBe(true);
    expect(scripts.has("task.py")).toBe(true);
    expect(scripts.has("get_developer.py")).toBe(true);
  });

  it("has at least one entry", () => {
    const scripts = getAllScripts();
    expect(scripts.size).toBeGreaterThan(0);
  });

  it("all values are non-empty strings", () => {
    const scripts = getAllScripts();
    for (const [key, value] of scripts) {
      expect(value.length, `${key} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it("values match the exported constants", () => {
    const scripts = getAllScripts();
    expect(scripts.get("__init__.py")).toBe(scriptsInit);
    expect(scripts.get("common/__init__.py")).toBe(commonInit);
    expect(scripts.get("common/task_workflow.py")).toBe(commonTaskWorkflow);
    expect(scripts.get("common/task_continuity.py")).toBe(commonTaskContinuity);
    expect(scripts.get("task.py")).toBe(taskScript);
  });

  it("does not contain multi_agent entries", () => {
    const scripts = getAllScripts();
    for (const [key] of scripts) {
      expect(key, `${key} should not be a multi_agent script`).not.toContain(
        "multi_agent",
      );
    }
  });
});

// =============================================================================
// getAllAgents — Teamwork participant definition dispatched at init/update.
// agent-loader.ts loads `.trellis/agents/<name>.md` and requires `---` YAML
// frontmatter at the top with a flat `name: <name>` field. These tests pin the
// contract so a future template edit can't silently break Teamwork spawn.
// =============================================================================

describe("getAllAgents", () => {
  it("ships only the generic teammate role and its profile registry", () => {
    const agents = getAllAgents();
    expect([...agents.keys()]).toEqual([
      "teammate.md",
      "teammate-profiles.json",
    ]);
  });

  it("values match exported constants", () => {
    const agents = getAllAgents();
    expect(agents.get("teammate.md")).toBe(teammateAgentTemplate);
  });

  it("documents Teamwork ownership boundaries and teammate report contract", () => {
    const skill = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/templates/common/bundled-skills/trellis-teamwork/SKILL.md",
      ),
      "utf8",
    );
    const teammate = getAllAgents().get("teammate.md") ?? "";
    expect(skill).toContain("independent from the Trellis task lifecycle");
    expect(skill).toContain("Teamwork validates and executes a frozen plan");
    expect(skill).toContain("references/teamwork-plan-construction.md");
    expect(skill).toContain("does not select the task phase");
    expect(teammate).toContain('"status": "complete"');
    expect(teammate).toContain('"source_digest"');
    expect(teammate).toContain('"evidence"');
    expect(teammate).toContain("attempts/<attempt-id>/report.json");
    expect(teammate).toContain("Do not read or use");
    expect(teammate).toContain("host exposes such memory and cannot isolate");
  });

  it("each agent body starts with `---` frontmatter and a matching name field", () => {
    const agents = getAllAgents();
    for (const [file, content] of agents) {
      if (file.endsWith(".json")) {
        expect(() => JSON.parse(content)).not.toThrow();
        continue;
      }
      expect(
        content.startsWith("---\n"),
        `${file} must start with --- frontmatter`,
      ).toBe(true);
      // Frontmatter must close on a `---\n` line.
      const frontmatterClose = content.indexOf("\n---\n", 4);
      expect(
        frontmatterClose,
        `${file} must have a closing --- frontmatter line`,
      ).toBeGreaterThan(0);
      const frontmatter = content.slice(4, frontmatterClose);
      // The agent's `name:` field must match the file basename so
      // `trellis teamwork spawn --agent <name>` resolves correctly.
      const expectedName = file.replace(/\.md$/, "");
      const nameLine = frontmatter
        .split("\n")
        .find((line) => /^name\s*:/.test(line));
      expect(nameLine, `${file} must declare a name field`).toBeTruthy();
      expect(
        nameLine?.split(":")[1]?.trim(),
        `${file} name field should equal "${expectedName}"`,
      ).toBe(expectedName);
    }
  });

  it("teammate profile template is provider-neutral and bounded", () => {
    const profiles = JSON.parse(
      getAllAgents().get("teammate-profiles.json") ?? "{}",
    );
    expect(profiles.default_provider).toBeUndefined();
    expect(profiles.profiles).toHaveProperty("architecture");
    expect(profiles.profiles).toHaveProperty("review");
  });
});

// =============================================================================
// config.yaml — context_injection section (issue #441)
// =============================================================================

describe("configYamlTemplate: context_injection section", () => {
  it("documents the context_injection block, fully commented out", () => {
    expect(configYamlTemplate).toContain("context_injection:");
    expect(configYamlTemplate).toContain("#   max_file_bytes: 32768");
    expect(configYamlTemplate).toContain("#   max_artifact_bytes: 65536");
    expect(configYamlTemplate).toContain("#   max_total_bytes: 131072");
    // Every context_injection line must be commented — the section ships
    // inert by default (matches the codex.dispatch_mode precedent).
    const lines = configYamlTemplate.split("\n");
    const start = lines.findIndex((l) => l.includes("context_injection:"));
    expect(start).toBeGreaterThan(-1);
    for (const line of lines.slice(start, start + 4)) {
      expect(line.trimStart().startsWith("#")).toBe(true);
    }
  });
});
