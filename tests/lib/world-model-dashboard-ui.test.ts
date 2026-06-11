import { summarizeDashboardActions } from "@/lib/world-model-dashboard-ui";
import type { ObservationRecord } from "@/server/services/types";

function observation(id: string, status: ObservationRecord["status"], metadata: Record<string, unknown> = {}): ObservationRecord {
  return {
    id,
    title: id,
    content: id,
    observedAt: new Date("2026-06-11T08:00:00.000Z"),
    status,
    credibility: 0.7,
    metadata
  };
}

describe("world model dashboard UI", () => {
  it("prioritizes actionable blockers for the overview page without duplicate links", () => {
    const actions = summarizeDashboardActions({
      observations: [
        observation("review", "PENDING", {
          recommendedLinks: [
            {
              hypothesisId: "hypothesis_1",
              direction: "SUPPORTS",
              relevance: 0.9,
              likelihoodRatio: 2,
              confidence: 0.8,
              rationale: "Relevant evidence."
            }
          ]
        }),
        observation("pending", "PENDING"),
        observation("unknown", "UNKNOWN"),
        observation("duplicate", "DUPLICATE")
      ],
      reviewDueHypothesisCount: 2,
      automation: {
        diagnostics: [
          {
            level: "warning",
            title: "LLM 主评分器未配置",
            detail: "LLM API 是 v1 主评分器；缺少配置时，候选识别和似然评分会退化为 fallback 或待审。"
          },
          {
            level: "info",
            title: "观察等待处理",
            detail: "4 条观察尚未确认为证据，处理后才能继续更新对应假设和信念。"
          }
        ],
        nextActions: [
          { label: "检查模型配置", href: "/admin/world-model/models" },
          { label: "处理观察积压", href: "/admin/world-model/observations" }
        ]
      }
    });

    expect(actions.map((action) => action.label)).toEqual([
      "处理待审候选",
      "复核假设时效",
      "检查模型配置",
      "处理观察积压"
    ]);
    expect(actions.find((action) => action.label === "处理待审候选")?.detail).toContain("1 条候选");
    expect(actions.find((action) => action.label === "处理观察积压")?.detail).toContain("3 条观察");
  });
});
