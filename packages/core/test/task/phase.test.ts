import { describe, expect, it } from "vitest";

import {
  isTaskPhaseId,
  parseTaskWorkflowState,
  TASK_PHASE_IDS,
} from "../../src/task/index.js";

describe("task phase identifiers", () => {
  it("exposes the five distinct business phases", () => {
    expect(TASK_PHASE_IDS).toEqual([
      "goal_exploration_and_requirements",
      "decision_space_construction_and_merging",
      "solution_design_and_convergence",
      "task_implementation",
      "delivery_review_and_closeout",
    ]);
  });

  it("accepts only declared phase identifiers", () => {
    expect(isTaskPhaseId("task_implementation")).toBe(true);
    expect(isTaskPhaseId("in_progress")).toBe(false);
    expect(isTaskPhaseId(null)).toBe(false);
  });

  it("validates an evidence-backed phase route", () => {
    const artifactRevision = "e".repeat(64);
    const state = {
      schema_version: 1,
      task_route_revision: "1",
      task_kind: "combined",
      complexity: "standard",
      project_context: "existing",
      phase_ids: [TASK_PHASE_IDS[0], TASK_PHASE_IDS[2]],
      current_phase_id: TASK_PHASE_IDS[0],
      input_revision: "1",
      phases: Object.fromEntries(
        [TASK_PHASE_IDS[0], TASK_PHASE_IDS[2]].map((phaseId, index) => [
          phaseId,
          {
            status: index === 0 ? "active" : "not_started",
            input_revision: "1",
            artifact_revision: artifactRevision,
            result_revision: "0",
            artifact_refs: [],
            result_ref: null,
            outcome_kind: null,
            reason: null,
            evidence_refs: [],
            acceptance: null,
          },
        ]),
      ),
      implementation_authorization: null,
      closeout_disposition: null,
      skip_records: {
        [TASK_PHASE_IDS[1]]: {
          reason: "No decision branch applies",
          evidence_refs: ["prd.md"],
          task_route_revision: "1",
        },
      },
      return_record: null,
    };

    expect(parseTaskWorkflowState(state)).toEqual(state);
    expect(() =>
      parseTaskWorkflowState({ ...state, phase_ids: [TASK_PHASE_IDS[2]] }),
    ).toThrow(/begin with requirements alignment/);
  });

  it("requires accepted phase 1 to retain confirmation for its current artifact revision", () => {
    const artifactRevision = "e".repeat(64);
    const phase1 = {
      status: "accepted",
      input_revision: "1",
      artifact_revision: artifactRevision,
      result_revision: "1",
      artifact_refs: ["prd.md"],
      result_ref: "prd.md",
      outcome_kind: "accepted",
      reason: null,
      evidence_refs: ["prd.md"],
      acceptance: {
        artifact_revision: artifactRevision,
        result_revision: "1",
        input_revision: "1",
        task_route_revision: "1",
        evidence_refs: ["prd.md"],
        user_confirmation_ref: "user-message:requirements-approved",
      },
    };
    const state = {
      schema_version: 1,
      task_route_revision: "1",
      task_kind: "analysis",
      complexity: "simple",
      project_context: "existing",
      phase_ids: [TASK_PHASE_IDS[0]],
      current_phase_id: null,
      input_revision: "2",
      phases: { [TASK_PHASE_IDS[0]]: phase1 },
      implementation_authorization: null,
      closeout_disposition: null,
      skip_records: {},
      return_record: null,
    };
    expect(parseTaskWorkflowState(state)).toEqual(state);
    expect(() =>
      parseTaskWorkflowState({
        ...state,
        phases: {
          [TASK_PHASE_IDS[0]]: {
            ...phase1,
            acceptance: { ...phase1.acceptance, user_confirmation_ref: " " },
          },
        },
      }),
    ).toThrow(/confirmation for its current artifact revision/);
    expect(() =>
      parseTaskWorkflowState({
        ...state,
        phases: {
          [TASK_PHASE_IDS[0]]: {
            ...phase1,
            artifact_revision: "a".repeat(64),
          },
        },
      }),
    ).toThrow(/confirmation for its current artifact revision/);
  });
});
