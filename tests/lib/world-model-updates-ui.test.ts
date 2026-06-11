import { summarizeUpdateDelta } from "@/lib/world-model-updates-ui";
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
});
