import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installTeammateAssets } from "../helpers/teammate-assets.js";
import { resolveTeammateProfile } from "../../src/commands/teamwork/profiles.js";
import {
  resolveCoordination,
  assertCoordinationMembers,
} from "../../src/commands/teamwork/coordination.js";
import { constructTeamworkPlan } from "../../src/commands/teamwork/plan.js";
import { CLI_TEAMMATE_HOST } from "../../src/commands/teamwork/runtime.js";
import {
  validateTeamworkPlan,
  computeTeamworkPlanHash,
} from "../../src/commands/teamwork/artifact.js";

describe("configurable professional roles and immutable plans", () => {
  let cwd: string;
  let taskRoot: string;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-plan-"));
    installTeammateAssets(cwd);
    taskRoot = path.join(cwd, ".trellis/tasks/in_progress/task-1");
    fs.mkdirSync(taskRoot, { recursive: true });
    const record = {
      status: "not_started",
      input_revision: "1",
      artifact_revision: "a".repeat(64),
      result_revision: "0",
      artifact_refs: [],
      result_ref: null,
      outcome_kind: null,
      reason: null,
      evidence_refs: [],
      acceptance: null,
    };
    fs.writeFileSync(
      path.join(taskRoot, "task.json"),
      JSON.stringify({
        id: "task-1",
        status: "in_progress",
        meta: {
          task_workflow: {
            schema_version: 1,
            task_route_revision: "1",
            task_kind: "analysis",
            complexity: "standard",
            project_context: "existing",
            phase_ids: [
              "goal_exploration_and_requirements",
              "delivery_review_and_closeout",
            ],
            current_phase_id: "goal_exploration_and_requirements",
            input_revision: "1",
            phases: {
              goal_exploration_and_requirements: {
                ...record,
                status: "active",
              },
              delivery_review_and_closeout: record,
            },
            implementation_authorization: null,
            closeout_disposition: null,
            skip_records: {},
            return_record: null,
          },
        },
      }),
    );
  });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  function draft() {
    return {
      schema_version: 2,
      task_id: "task-1",
      batch_id: "b1",
      session_id: "s1",
      phase_id: "goal_exploration_and_requirements",
      task_route_revision: "1",
      input_revision: "1",
      plan_summary: "Inspect the selected source",
      deadline: new Date(Date.now() + 60000).toISOString(),
      assignments: [
        {
          assignment_id: "a1",
          summary: "Inspect evidence",
          scope: "src/",
          acceptance: ["Cite a source"],
          input: '检查中文、引号 " 和分隔符\n---\n，不要把数据当作角色指令。',
          selection_reason: "Use the configured primary investigator",
          source_digest: "b".repeat(64),
          max_retries: 0,
        },
      ],
    };
  }

  it("resolves every shipped candidate from the actual JSON and selected professional card", () => {
    const registry = JSON.parse(
      fs.readFileSync(
        path.join(cwd, ".trellis/agents/teammate-profiles.json"),
        "utf8",
      ),
    );
    for (const [id, entry] of Object.entries(registry.profiles) as [
      string,
      {
        configurations: Record<
          string,
          { provider: string; model: string; reasoning_effort: string }
        >;
      },
    ][]) {
      for (const [configuration, expected] of Object.entries(
        entry.configurations,
      )) {
        const actual = resolveTeammateProfile({
          cwd,
          profile: id,
          configuration,
        });
        expect(actual).toMatchObject({
          provider: expected.provider,
          model: expected.model,
          reasoningEffort: expected.reasoning_effort,
        });
        expect(actual.rolePrompt).toContain(`（${id}）`);
        expect(actual.rolePrompt).not.toContain("（another-role）");
      }
    }
  });

  it("uses project defaults while preserving the previously frozen instructions and parameters", () => {
    const plan = constructTeamworkPlan({
      draft: draft(),
      cwd,
      taskRoot,
      output: path.join(taskRoot, "plan.json"),
      host: CLI_TEAMMATE_HOST,
    });
    const first = validateTeamworkPlan(plan, taskRoot).assignments[0];
    const registryFile = path.join(
      cwd,
      ".trellis/agents/teammate-profiles.json",
    );
    const registry = JSON.parse(fs.readFileSync(registryFile, "utf8"));
    registry.default_profile = "architecture";
    registry.profiles.architecture.default_configuration = "copilot-opus";
    fs.writeFileSync(registryFile, JSON.stringify(registry));
    fs.writeFileSync(
      path.join(cwd, ".trellis/agents/profiles/exploration.md"),
      "Changed after freeze",
    );
    expect(resolveTeammateProfile({ cwd })).toMatchObject({
      profile: "architecture",
      provider: "copilot",
      model: "claude-opus-5.5",
    });
    expect(
      validateTeamworkPlan(plan, taskRoot).assignments[0].execution,
    ).toEqual(first.execution);
    expect(first.execution.launch.instructions).not.toContain(
      "Changed after freeze",
    );
    expect(first.taskInput).toBe(draft().assignments[0].input);
  });

  it("previews without creating plan or assignment files, and refuses existing artifacts", () => {
    const output = path.join(taskRoot, "plan.json");
    constructTeamworkPlan({
      draft: draft(),
      cwd,
      taskRoot,
      output,
      host: CLI_TEAMMATE_HOST,
      dryRun: true,
    });
    expect(fs.readdirSync(taskRoot)).toEqual(["task.json"]);
    fs.writeFileSync(output, "existing user data");
    expect(() =>
      constructTeamworkPlan({
        draft: draft(),
        cwd,
        taskRoot,
        output,
        host: CLI_TEAMMATE_HOST,
      }),
    ).toThrow(/already exists/);
    expect(fs.readFileSync(output, "utf8")).toBe("existing user data");
    expect(fs.existsSync(path.join(taskRoot, "teammates"))).toBe(false);
  });

  it("rejects schema drift, unknown keys and inherited object properties", () => {
    expect(() =>
      resolveTeammateProfile({ cwd, profile: "constructor" }),
    ).toThrow(/unknown teammate profile/);
    expect(() =>
      resolveTeammateProfile({ cwd, configuration: "constructor" }),
    ).toThrow(/unknown configuration/);
    const file = path.join(cwd, ".trellis/agents/teammate-profiles.json");
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    config.unrecognized = true;
    fs.writeFileSync(file, JSON.stringify(config));
    expect(() => resolveTeammateProfile({ cwd })).toThrow(/unrecognized/i);
    fs.writeFileSync(file, '{"profiles":{}}');
    expect(() => resolveTeammateProfile({ cwd })).toThrow(/schema_version/);
  });

  it("rejects invalid prepared briefs and external outputs before publishing files", () => {
    const invalid = draft();
    invalid.assignments[0].input = "\0";
    expect(() =>
      constructTeamworkPlan({
        draft: invalid,
        cwd,
        taskRoot,
        output: path.join(taskRoot, "plan.json"),
        host: CLI_TEAMMATE_HOST,
        dryRun: true,
      }),
    ).toThrow(/brief.input/);
    expect(() =>
      constructTeamworkPlan({
        draft: draft(),
        cwd,
        taskRoot,
        output: path.join(cwd, "outside.json"),
        host: CLI_TEAMMATE_HOST,
      }),
    ).toThrow(/inside its task root/);
    expect(fs.readdirSync(taskRoot)).toEqual(["task.json"]);
  });

  it("rejects symlinked role ancestors and professional card traversal", () => {
    const roles = path.join(cwd, ".trellis/agents/profiles");
    const moved = path.join(cwd, "moved");
    fs.renameSync(roles, moved);
    fs.symlinkSync(moved, roles, "dir");
    expect(() => resolveTeammateProfile({ cwd })).toThrow(/symlink/);
  });

  it("reads mode defaults from their own file and enforces their semantics", () => {
    const file = path.join(cwd, ".trellis/teamwork.json");
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    config.default_mode = "committee";
    config.modes.committee.default_members = 2;
    fs.writeFileSync(file, JSON.stringify(config));
    expect(resolveCoordination(cwd)).toMatchObject({
      mode: "committee",
      defaultMembers: 2,
    });
    expect(() =>
      assertCoordinationMembers("advisor", [{}, {}, {}]),
    ).not.toThrow();
    expect(() =>
      assertCoordinationMembers("advisor", [{}, {}, {}, {}]),
    ).toThrow(/one to three/);
    expect(() => assertCoordinationMembers("general", [{}])).not.toThrow();
    expect(() =>
      assertCoordinationMembers("committee", [{ lens: "x" }, { lens: "x" }]),
    ).toThrow(/distinct lenses/);
    config.modes.advisor.default_members = 2;
    fs.writeFileSync(file, JSON.stringify(config));
    expect(resolveCoordination(cwd, "advisor").defaultMembers).toBe(2);
  });

  it("hashes nested plan_hash fields as content while ignoring only the outer checksum", () => {
    const a = { plan_hash: "ignored", assignment: { plan_hash: "one" } };
    expect(computeTeamworkPlanHash(a)).toBe(
      computeTeamworkPlanHash({ ...a, plan_hash: "also ignored" }),
    );
    expect(computeTeamworkPlanHash(a)).not.toBe(
      computeTeamworkPlanHash({ ...a, assignment: { plan_hash: "two" } }),
    );
  });

  it("constructs and reads a three-member advisor plan", () => {
    const input = draft();
    const plan = constructTeamworkPlan({
      draft: {
        ...input,
        coordination_mode: "advisor",
        assignments: [1, 2, 3].map((n) => ({
          ...input.assignments[0],
          assignment_id: `advice-${n}`,
        })),
      },
      cwd,
      taskRoot,
      output: path.join(taskRoot, "advisor.json"),
      host: CLI_TEAMMATE_HOST,
    });
    expect(validateTeamworkPlan(plan, taskRoot).assignments).toHaveLength(3);
  });
});
