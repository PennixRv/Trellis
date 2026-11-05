import { describe, expect, it } from "vitest";

import {
  isTaskPhaseId,
  parseTaskWorkflowState,
  TASK_PHASE_IDS,
} from "../../src/task/index.js";

describe("task phase identifiers", () => {
  it("exposes the canonical business phase identifiers", () => {
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
      phase_ids: [TASK_PHASE_IDS[0], TASK_PHASE_IDS[2], TASK_PHASE_IDS[4]],
      current_phase_id: TASK_PHASE_IDS[0],
      input_revision: "1",
      phases: Object.fromEntries(
        [TASK_PHASE_IDS[0], TASK_PHASE_IDS[2], TASK_PHASE_IDS[4]].map(
          (phaseId, index) => [
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
          ],
        ),
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
    const admission = {
      task_route_revision: "1",
      dependencies: ["provider-transport"],
      admission_state: "ready",
      evidence_refs: ["runtime-receipt.json"],
    };
    expect(
      parseTaskWorkflowState({
        ...state,
        route_dependency_admission: admission,
      }),
    ).toMatchObject({ route_dependency_admission: admission });
    for (const invalid of [
      { ...admission, admission_state: "available" },
      {
        ...admission,
        dependencies: ["provider-transport", "provider-transport"],
      },
      { ...admission, evidence_refs: [" "] },
    ]) {
      expect(() =>
        parseTaskWorkflowState({
          ...state,
          route_dependency_admission: invalid,
        }),
      ).toThrow(/route_dependency_admission is invalid/);
    }
    const analysisRouteWithImplementation = {
      ...state,
      task_kind: "analysis",
      phase_ids: [
        TASK_PHASE_IDS[0],
        TASK_PHASE_IDS[2],
        TASK_PHASE_IDS[3],
        TASK_PHASE_IDS[4],
      ],
      phases: {
        ...state.phases,
        [TASK_PHASE_IDS[3]]: {
          status: "not_started",
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
      },
    };
    expect(() =>
      parseTaskWorkflowState(analysisRouteWithImplementation),
    ).toThrow(
      /analysis tasks cannot include the Task Implementation and Test Verification Phase/,
    );
    expect(() =>
      parseTaskWorkflowState({ ...state, phase_ids: [TASK_PHASE_IDS[2]] }),
    ).toThrow(
      /begin with Goal Exploration and Requirements Confirmation Phase/,
    );
    expect(() =>
      parseTaskWorkflowState({
        ...state,
        phase_ids: [TASK_PHASE_IDS[0], TASK_PHASE_IDS[2]],
      }),
    ).toThrow(/end with Delivery Review and On-Site Closeout Phase/);
    const authorization = {
      contract_ref: "design.md",
      contract_revision: artifactRevision,
      approval_ref: "user-message:implementation-approved",
      task_route_revision: "1",
    };
    expect(
      parseTaskWorkflowState({
        ...state,
        implementation_authorization: authorization,
      }),
    ).toMatchObject({ implementation_authorization: authorization });
    expect(() =>
      parseTaskWorkflowState({
        ...state,
        implementation_authorization: { ...authorization, contract_ref: " " },
      }),
    ).toThrow(/implementation_authorization is invalid/);
    expect(() =>
      parseTaskWorkflowState({
        ...state,
        implementation_authorization: {
          ...authorization,
          contract_revision: undefined,
        },
      }),
    ).toThrow(/implementation_authorization is invalid/);
    expect(() =>
      parseTaskWorkflowState({
        ...state,
        implementation_authorization: { ...authorization, approval_ref: " " },
      }),
    ).toThrow(/implementation_authorization is invalid/);

    const skippedPhase = {
      status: "skipped",
      input_revision: "1",
      artifact_revision: artifactRevision,
      result_revision: "1",
      artifact_refs: [],
      result_ref: null,
      outcome_kind: null,
      reason: "The decision branch was unnecessary",
      evidence_refs: ["prd.md"],
      acceptance: {
        artifact_revision: artifactRevision,
        result_revision: "1",
        input_revision: "1",
        task_route_revision: "1",
        evidence_refs: ["prd.md"],
      },
    };
    const confirmedSkipState = {
      ...state,
      phase_ids: [
        TASK_PHASE_IDS[0],
        TASK_PHASE_IDS[1],
        TASK_PHASE_IDS[2],
        TASK_PHASE_IDS[4],
      ],
      phases: { ...state.phases, [TASK_PHASE_IDS[1]]: skippedPhase },
      skip_records: {
        [TASK_PHASE_IDS[1]]: {
          reason: skippedPhase.reason,
          evidence_refs: skippedPhase.evidence_refs,
          task_route_revision: "1",
        },
      },
    };
    expect(parseTaskWorkflowState(confirmedSkipState)).toEqual(
      confirmedSkipState,
    );

    const returnRecord = {
      from: TASK_PHASE_IDS[2],
      to: TASK_PHASE_IDS[0],
      reason: "Requirements changed",
      evidence_refs: ["user-message:requirements-changed"],
      task_route_revision: "1",
    };
    expect(
      parseTaskWorkflowState({ ...state, return_record: returnRecord })
        .return_record,
    ).toEqual(returnRecord);
    const rework = {
      ...returnRecord,
      from: TASK_PHASE_IDS[4],
      to: TASK_PHASE_IDS[3],
      return_kind: "execution_rework",
      authorization_retained: true,
    };
    expect(
      parseTaskWorkflowState({ ...state, return_record: rework }).return_record,
    ).toEqual(rework);
    for (const invalid of [
      { ...rework, return_kind: "unknown" },
      { ...rework, authorization_retained: false },
      { ...rework, to: TASK_PHASE_IDS[2] },
      { ...rework, return_kind: "contract_change" },
    ]) {
      expect(() =>
        parseTaskWorkflowState({ ...state, return_record: invalid }),
      ).toThrow(/rework semantics/);
    }
  });

  it("requires accepted Goal Exploration and Requirements Confirmation Phase to retain evidence for its current artifact revision", () => {
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
      },
    };
    const state = {
      schema_version: 1,
      task_route_revision: "1",
      task_kind: "analysis",
      complexity: "simple",
      project_context: "existing",
      phase_ids: [TASK_PHASE_IDS[0], TASK_PHASE_IDS[4]],
      current_phase_id: TASK_PHASE_IDS[4],
      input_revision: "2",
      phases: {
        [TASK_PHASE_IDS[0]]: phase1,
        [TASK_PHASE_IDS[4]]: {
          status: "active",
          input_revision: "2",
          artifact_revision: artifactRevision,
          result_revision: "0",
          artifact_refs: [],
          result_ref: null,
          outcome_kind: null,
          reason: null,
          evidence_refs: [],
          acceptance: null,
        },
      },
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
            acceptance: { ...phase1.acceptance, evidence_refs: [] },
          },
        },
      }),
    ).toThrow(/acceptance is invalid/);
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
