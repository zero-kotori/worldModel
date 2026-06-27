import { canRollbackUpdate, createRollbackOptions, summarizeUpdateDelta, summarizeUpdateExplanation } from "@/lib/world-model-updates-ui";
import type { BayesianUpdateEventRecord } from "@/server/services/types";

function update(input: Partial<BayesianUpdateEventRecord>): BayesianUpdateEventRecord {
  return {
    id: "update_1",
    beliefId: "belief_1",
    evidenceId: "evidence_1",
    priorSnapshot: { hypothesis_1: 0.4, hypothesis_2: 0.6 },
    posteriorSnapshot: { hypothesis_1: 0.55, hypothesis_2: 0.45 },
    mode: "APPLIED",
    status: "APPLIED",
    confidence: 0.8,
    explanations: [],
    createdAt: new Date("2026-06-11T08:00:00.000Z"),
    ...input
  };
}

describe("world model updates UI", () => {
  it("summarizes the largest probability movement for an applied update", () => {
    expect(summarizeUpdateDelta(update({}), (id) => (id === "hypothesis_1" ? "H-001" : id))).toEqual({
      label: "+15.0pp",
      detail: "H-001 40.0% -> 55.0%",
      tone: "increase"
    });
  });

  it("keeps the original movement visible after rollback", () => {
    expect(
      summarizeUpdateDelta(
        update({
          status: "ROLLED_BACK",
          rolledBackAt: new Date("2026-06-11T09:00:00.000Z")
        }),
        (id) => (id === "hypothesis_1" ? "H-001" : id)
      )
    ).toEqual({
      label: "已回滚",
      detail: "原变化 H-001 +15.0pp",
      tone: "neutral"
    });
  });

  it("creates rollback options only for applied update events", () => {
    const applied = update({ id: "update_applied", evidenceId: "evidence_applied", status: "APPLIED" });
    const rolledBack = update({
      id: "update_rolled_back",
      evidenceId: "evidence_rolled_back",
      status: "ROLLED_BACK",
      rolledBackAt: new Date("2026-06-11T09:00:00.000Z")
    });

    expect(canRollbackUpdate(applied)).toBe(true);
    expect(canRollbackUpdate(rolledBack)).toBe(false);
    expect(
      createRollbackOptions(
        [applied, rolledBack],
        (eventId) => (eventId === "update_applied" ? "U-001" : eventId),
        (evidenceId) => (evidenceId === "evidence_applied" ? "E-001 · Applied evidence" : evidenceId)
      )
    ).toEqual([
      {
        value: "update_applied",
        label: "U-001 · E-001 · Applied evidence · APPLIED"
      }
    ]);
  });

  it("summarizes update explanations with human-readable hypothesis labels", () => {
    expect(
      summarizeUpdateExplanation(
        update({
          explanations: ["hypothesis_1: Strong evidence increased the belief.", "Fallback explanation without id"]
        }),
        (id) => (id === "hypothesis_1" ? "H-001 · AI agents improve delivery quality" : id)
      )
    ).toBe("H-001 · AI agents improve delivery quality: Strong evidence increased the belief.");
  });
});
