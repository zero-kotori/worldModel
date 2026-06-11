import { createWorldModelGraphEditorData } from "@/lib/world-model-graph-editor";
import type { BeliefRecord } from "@/server/services/types";

describe("world model graph editor data", () => {
  it("keeps hypothesis time windows editable in graph workspaces", () => {
    const startsAt = new Date("2026-06-12T01:30:00.000Z");
    const expiresAt = new Date("2026-06-20T01:30:00.000Z");
    const belief: BeliefRecord = {
      id: "belief_market",
      title: "市场判断",
      category: "INVESTMENT",
      description: "跟踪市场假设",
      probabilityMode: "INDEPENDENT",
      status: "ACTIVE",
      createdAt: new Date("2026-06-10T00:00:00.000Z"),
      updatedAt: new Date("2026-06-10T00:00:00.000Z"),
      hypotheses: [
        {
          id: "hypothesis_alpha",
          beliefId: "belief_market",
          proposition: "流动性改善将支撑估值",
          notes: "需要每周复核",
          stance: "SUPPORTS",
          priorProbability: 0.45,
          currentProbability: 0.58,
          strength: 0.58,
          status: "ACTIVE",
          startsAt,
          expiresAt,
          expiryCondition: "央行政策路径发生反转",
          createdAt: new Date("2026-06-11T00:00:00.000Z"),
          updatedAt: new Date("2026-06-11T00:00:00.000Z")
        }
      ]
    };

    const editor = createWorldModelGraphEditorData({ beliefs: [belief], evidence: [], updates: [] });

    expect(editor.hypotheses[0]).toMatchObject({
      startsAt,
      expiresAt,
      expiryCondition: "央行政策路径发生反转"
    });
  });
});
