import { describe, expect, it } from "vitest";
import { getCommandTemplates } from "../../src/templates/common/index.js";
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

  it("workflow index keeps named business-phase Skills and transitions distinct", () => {
    for (const phase of [
      "goal_exploration_and_requirements",
      "decision_space_construction_and_merging",
      "solution_design_and_convergence",
      "task_implementation",
      "delivery_review_and_closeout",
    ]) {
      expect(workflowMdTemplate).toContain(`\`${phase}\``);
      expect(workflowMdTemplate).toContain(`${phase}[`);
    }
    for (const title of [
      "目标探索与需求核对阶段",
      "决策空间构造与归并阶段",
      "解决方案设计与收敛阶段",
      "任务实施与测试验证阶段",
      "交付审查与现场收尾阶段",
    ]) {
      expect(workflowMdTemplate).toContain(`| ${title} |`);
    }
    expect(workflowMdTemplate).toContain("当前基线已获用户确认");
    expect(workflowMdTemplate).toContain("实施合同已授权");
    expect(workflowMdTemplate).toContain("会话交接");
    expect(workflowMdTemplate).not.toContain("phase model");
  });

  it("keeps Task Implementation and Test Verification Phase tools conditional on the task and change", () => {
    const implementationState = workflowStateBreadcrumb("in_progress");
    expect(implementationState).toContain("运行与改动相称的验证");
    expect(implementationState).toContain("可使用 `trellis-before-dev`");
    expect(implementationState).toContain("可使用 `trellis-check`");
  });

  it("phase entries preserve confirmation, conditional decision trees, and closeout", () => {
    expect(stepSection("1.1")).toContain("当前资产 revision 的用户明确确认");
    expect(stepSection("2.1")).toContain("读取决策空间构造与归并阶段 Skill");
    const decisionSpaceConstructionAndMergingWorkflow = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/templates/common/bundled-skills/trellis-decision-space-construction-and-merging/workflow.md",
      ),
      "utf-8",
    );
    expect(decisionSpaceConstructionAndMergingWorkflow).toContain(
      "仅当选择之间存在条件依赖时使用决策树",
    );
    expect(decisionSpaceConstructionAndMergingWorkflow).toContain(
      "prior-art review",
    );
    expect(stepSection("3.1")).toContain("解决必要的用户决定");
    expect(stepSection("4.1")).toContain(
      "只有明确授权委派 Git worktree 写入时才使用 Paseo",
    );
    expect(stepSection("5.2")).toContain("正式会话交接仍是独立操作");
  });

  it("phase diagrams use standard names and show conditional delivery acceptance", () => {
    const phaseSkills: [string, string][] = [
      ["trellis-goal-exploration-and-requirements", "目标探索与需求核对阶段"],
      [
        "trellis-decision-space-construction-and-merging",
        "决策空间构造与归并阶段",
      ],
      ["trellis-solution-design-and-convergence", "解决方案设计与收敛阶段"],
      ["trellis-task-implementation", "任务实施与测试验证阶段"],
      ["trellis-delivery-review-and-closeout", "交付审查与现场收尾阶段"],
    ];
    const workflows = new Map(
      phaseSkills.map(([name]) => [
        name,
        fs.readFileSync(
          path.resolve(
            __dirname,
            "../../src/templates/common/bundled-skills",
            name,
            "workflow.md",
          ),
          "utf-8",
        ),
      ]),
    );
    for (const [name, title] of phaseSkills) {
      const content = workflows.get(name) ?? "";
      expect(content).toContain(`# ${title}流程`);
      const diagrams = [...content.matchAll(/```mermaid\s*([\s\S]*?)```/g)];
      expect(
        diagrams.length,
        `${name} should contain a workflow diagram`,
      ).toBeGreaterThan(0);
      for (const [, diagram] of diagrams) {
        expect(diagram).not.toMatch(/阶段\s*[一二三四五1-5]/);
      }
    }
    const deliveryWorkflow =
      workflows.get("trellis-delivery-review-and-closeout") ?? "";
    const deliveryDiagram =
      deliveryWorkflow.match(/```mermaid\s*([\s\S]*?)```/)?.[1] ?? "";
    expect(deliveryDiagram).toContain("必要用户决定缺失");
    expect(deliveryDiagram).toContain("pennix-decision-grill 同步请求用户接受");
    expect(deliveryDiagram).toContain(
      "Trellis CLI 接受 delivery_ready 或 no_go",
    );
    expect(deliveryDiagram).toContain(
      "交付合同、用户明确要求或不可由主代理替代的价值/风险取舍要求用户接受",
    );
    expect(deliveryDiagram).toContain(
      'child_disposition -->|"无关联子任务"| cancelReview',
    );
    expect(deliveryDiagram).toContain("使当前交付候选失效并判断最早受影响阶段");
    expect(deliveryDiagram).toContain(
      "Trellis CLI 将路线收敛为仅‘交付审查与现场收尾阶段’并记录原因",
    );
    expect(deliveryDiagram).toContain("关联子任务如何处置？");
    expect(deliveryDiagram).toContain("记录子任务标识与依据后解除父子关系");
    expect(deliveryDiagram).toContain("另行执行子任务自身的取消流程");
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

  it("workflow.md Goal Exploration and Requirements Confirmation Phase provides the baseline", () => {
    const step = stepSection("1.1");
    expect(step).toContain("仅收集可能改变目标、范围");
    expect(step).toContain("用户明确确认");
    expect(step).toContain("当前资产 revision");
  });

  it("records routing judgment without a fixed complexity matrix", () => {
    const goalExplorationAndRequirementsSkill = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../src/templates/common/bundled-skills/trellis-goal-exploration-and-requirements/workflow.md",
      ),
      "utf-8",
    );
    expect(goalExplorationAndRequirementsSkill).toContain(
      "复杂度判断的实际触发维度与理由",
    );
    expect(goalExplorationAndRequirementsSkill).toContain(
      "不机械计分或套用固定路由矩阵",
    );
    expect(goalExplorationAndRequirementsSkill).toContain(
      "路线发生变化时，使用 Trellis CLI 更新受影响的分类和阶段",
    );
  });

  it("workflow.md planning breadcrumb requires a route before implementation", () => {
    const planning = workflowStateBreadcrumb("planning");
    const planningInline = workflowStateBreadcrumb("planning-inline");
    expect(planning).toContain("task.py phase init");
    expect(planning).toContain("实施授权");
    expect(planningInline).toContain("planning");
    expect(planningInline).toContain("主会话");
  });

  it("start command enters the requirements Skill and follows the current phase route", () => {
    const start =
      getCommandTemplates().find((command) => command.name === "start")
        ?.content ?? "";
    expect(start).toContain("trellis-goal-exploration-and-requirements");
    expect(start).toContain("business phase route");
    expect(start).not.toContain("trellis-brainstorm");
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
// getAllAgents — project agent roles dispatched at init/update.
// agent-loader.ts loads `.trellis/agents/<name>.md` and requires `---` YAML
// frontmatter at the top with a flat `name: <name>` field. These tests pin the
// contract so a future template edit can't silently break Teamwork spawn.
// =============================================================================

describe("getAllAgents", () => {
  it("ships the Teamwork and delegated worktree roles with the profile registry", () => {
    const agents = getAllAgents();
    const registry = JSON.parse(agents.get("teammate-profiles.json") ?? "{}");
    expect(agents.has("teammate.md")).toBe(true);
    expect(agents.has("delegated-worktree-primary-agent.md")).toBe(true);
    for (const profile of Object.values(registry.profiles) as {
      role: string;
    }[])
      expect(agents.has(profile.role)).toBe(true);
  });

  it("values match exported constants", () => {
    const agents = getAllAgents();
    expect(agents.get("teammate.md")).toBe(teammateAgentTemplate);
    expect(agents.get("delegated-worktree-primary-agent.md")).toContain(
      "sole task-specific implementation contract",
    );
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
    expect(teammate).toContain("do not claim technical memory");
  });

  it("each agent body starts with `---` frontmatter and a matching name field", () => {
    const agents = getAllAgents();
    for (const [file, content] of agents) {
      if (file.startsWith("profiles/")) {
        expect(content).toContain("输入");
        expect(content).toContain("结果");
        expect(content).toContain("停止");
        continue;
      }
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
