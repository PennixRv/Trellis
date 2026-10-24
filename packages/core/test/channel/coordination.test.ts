import { describe, expect, it } from "vitest";

import {
  assertCoordinationTransition,
  canTransition,
  reduceCoordinationState,
  type ChannelEvent,
} from "../../src/channel/index.js";

function event(
  seq: number,
  extra: Record<string, unknown>,
): ChannelEvent {
  return {
    seq,
    ts: `2026-10-24T00:00:${String(seq).padStart(2, "0")}.000Z`,
    kind: "coordination",
    by: "main",
    ...extra,
  } as ChannelEvent;
}

describe("coordination projection", () => {
  it("accepts the approved batch, work, attempt and teammate paths", () => {
    const state = reduceCoordinationState([
      event(1, {
        action: "state_transition",
        entity: "batch",
        batchId: "b1",
        state: "PREPARED",
        planHash: "p1",
      }),
      event(2, {
        action: "state_transition",
        entity: "batch",
        batchId: "b1",
        state: "VALIDATING_PLAN",
      }),
      event(3, {
        action: "state_transition",
        entity: "work",
        batchId: "b1",
        workId: "w1",
        state: "QUEUED",
      }),
      event(4, {
        action: "state_transition",
        entity: "work",
        batchId: "b1",
        workId: "w1",
        state: "ASSIGNED",
        attemptId: "a1",
        teammateId: "t1",
        slot: 0,
      }),
      event(5, {
        action: "state_transition",
        entity: "attempt",
        batchId: "b1",
        workId: "w1",
        attemptId: "a1",
        state: "ASSIGNED",
        teammateId: "t1",
      }),
      event(6, {
        action: "state_transition",
        entity: "teammate",
        batchId: "b1",
        attemptId: "a1",
        teammateId: "t1",
        state: "ASSIGNED",
      }),
      event(7, {
        action: "lease_acquired",
        entity: "attempt",
        batchId: "b1",
        attemptId: "a1",
        leaseId: "lease-1",
        protected: true,
      }),
    ]);

    expect(state.batches[0]).toMatchObject({
      batchId: "b1",
      state: "VALIDATING_PLAN",
      planHash: "p1",
    });
    expect(state.work[0]).toMatchObject({
      workId: "w1",
      state: "ASSIGNED",
      slot: 0,
      attemptId: "a1",
      teammateId: "t1",
    });
    expect(state.attempts[0].state).toBe("ASSIGNED");
    expect(state.teammates[0].state).toBe("ASSIGNED");
    expect(state.leases[0]).toMatchObject({ leaseId: "lease-1", protected: true });
    expect(state.issues).toEqual([]);
  });

  it("records invalid and late transitions without corrupting the projection", () => {
    const state = reduceCoordinationState([
      event(1, {
        action: "state_transition",
        entity: "work",
        batchId: "b1",
        workId: "w1",
        state: "QUEUED",
      }),
      event(2, {
        action: "state_transition",
        entity: "work",
        batchId: "b1",
        workId: "w1",
        state: "ACCEPTED",
      }),
      event(3, {
        action: "claim_created",
        entity: "work",
        batchId: "b1",
        workId: "w1",
        claimId: "claim-1",
      }),
      event(4, {
        action: "command_issued",
        entity: "attempt",
        batchId: "b1",
        attemptId: "a1",
        commandId: "cmd-1",
      }),
    ]);

    expect(state.work[0].state).toBe("QUEUED");
    expect(state.claims).toEqual(["claim-1"]);
    expect(state.commands).toEqual(["cmd-1"]);
    expect(state.issues).toHaveLength(1);
  });

  it("scopes projected work, attempts, teammates and leases to their batch", () => {
    const state = reduceCoordinationState([
      ...["b1", "b2"].flatMap((batchId, index) => {
        const seq = index * 10;
        return [
          event(seq + 1, {
            action: "state_transition",
            entity: "work",
            batchId,
            workId: "w1",
            state: "QUEUED",
          }),
          event(seq + 2, {
            action: "state_transition",
            entity: "attempt",
            batchId,
            workId: "w1",
            attemptId: "a1",
            teammateId: "t1",
            state: "ASSIGNED",
          }),
          event(seq + 3, {
            action: "state_transition",
            entity: "teammate",
            batchId,
            attemptId: "a1",
            teammateId: "t1",
            state: "ASSIGNED",
          }),
          event(seq + 4, {
            action: "lease_acquired",
            entity: "attempt",
            batchId,
            attemptId: "a1",
            leaseId: "lease-1",
            protected: true,
          }),
          ...(batchId === "b1"
            ? [
                event(seq + 5, {
                  action: "terminal_observed",
                  entity: "attempt",
                  batchId,
                  workId: "w1",
                  attemptId: "a1",
                  teammateId: "t1",
                  terminal: true,
                }),
                event(seq + 6, {
                  action: "lease_released",
                  entity: "attempt",
                  batchId,
                  attemptId: "a1",
                  leaseId: "lease-1",
                }),
              ]
            : []),
        ];
      }),
    ]);

    expect(state.work).toHaveLength(2);
    expect(state.attempts).toHaveLength(2);
    expect(state.teammates).toHaveLength(2);
    expect(state.leases).toEqual([
      expect.objectContaining({ batchId: "b2", leaseId: "lease-1", protected: true }),
    ]);
    expect(state.attempts.find((attempt) => attempt.batchId === "b1")?.terminal).toBe(true);
    expect(state.attempts.find((attempt) => attempt.batchId === "b2")?.terminal).toBeUndefined();
    expect(state.teammates.find((teammate) => teammate.batchId === "b1")?.terminal).toBe(true);
    expect(state.teammates.find((teammate) => teammate.batchId === "b2")?.terminal).toBeUndefined();
    expect(state.issues).toEqual([]);
  });

  it("requires explicit retry and timeout paths", () => {
    expect(canTransition("attempt", "TIMEOUT_YIELDED", "WAITING_FOR_MAIN_COMMAND")).toBe(true);
    expect(canTransition("attempt", "TIMEOUT_YIELDED", "ASSIGNED")).toBe(false);
    expect(canTransition("work", "VALIDATING", "ASSIGNED")).toBe(true);
    expect(() => assertCoordinationTransition("teammate", "FAILED", "RUNNING")).toThrow(
      "invalid teammate transition",
    );
  });

  it("deduplicates durable facts, preserves terminal separation, and carries host facts", () => {
    const state = reduceCoordinationState([
      event(1, {
        action: "state_transition",
        entity: "attempt",
        batchId: "b1",
        workId: "w1",
        attemptId: "a1",
        teammateId: "t1",
        state: "ASSIGNED",
        sessionId: "session-1",
      }),
      event(2, {
        action: "state_transition",
        entity: "attempt",
        batchId: "b1",
        workId: "w1",
        attemptId: "a1",
        teammateId: "t1",
        state: "RUNNING",
        sessionId: "session-1",
      }),
      event(3, {
        action: "state_transition",
        entity: "attempt",
        batchId: "b1",
        workId: "w1",
        attemptId: "a1",
        teammateId: "t1",
        state: "REPORT_SUBMITTED",
        sessionId: "session-1",
        terminal: true,
      }),
      event(4, {
        action: "state_transition",
        entity: "attempt",
        batchId: "b1",
        workId: "w1",
        attemptId: "a1",
        state: "RUNNING",
      }),
      event(5, {
        action: "claim_created",
        entity: "attempt",
        batchId: "b1",
        attemptId: "a1",
        claimId: "claim-1",
      }),
      event(6, {
        action: "claim_created",
        entity: "attempt",
        batchId: "b1",
        attemptId: "a1",
        claimId: "claim-1",
      }),
      event(7, {
        action: "command_issued",
        entity: "attempt",
        batchId: "b1",
        attemptId: "a1",
        commandId: "command-1",
      }),
      event(8, {
        action: "command_issued",
        entity: "attempt",
        batchId: "b1",
        attemptId: "a1",
        commandId: "command-1",
      }),
      event(9, {
        action: "receipt_recorded",
        entity: "batch",
        batchId: "b1",
        receiptId: "receipt-1",
      }),
      event(10, {
        action: "receipt_recorded",
        entity: "batch",
        batchId: "b1",
        receiptId: "receipt-1",
      }),
      event(11, {
        action: "terminal_observed",
        entity: "attempt",
        batchId: "b1",
        workId: "w1",
        attemptId: "a1",
        teammateId: "t1",
        sessionId: "session-1",
        terminal: true,
      }),
    ]);

    expect(state.attempts[0]).toMatchObject({
      state: "REPORT_SUBMITTED",
      sessionId: "session-1",
      terminal: true,
    });
    expect(state.issues).toContain("4: invalid attempt transition REPORT_SUBMITTED -> RUNNING");
    expect(state.claims).toEqual(["claim-1"]);
    expect(state.commands).toEqual(["command-1"]);
    expect(state.receipts).toEqual(["receipt-1"]);
  });
});
