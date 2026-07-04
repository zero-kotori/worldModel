import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
import type { BeliefRecord, ObservationRecord } from "@/server/services/types";

const loadWorldModelData = vi.fn();
const recommendHypotheses = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/app/admin/world-model/data", () => ({
  loadWorldModelData
}));

vi.mock("@/server/services", () => ({
  getWorldModelServices: () => ({
    beliefs: {
      recommendHypotheses
    }
  })
}));

vi.mock("@/components/world-model/WorldModelGraphView", () => ({
  WorldModelGraphView: () => React.createElement("div", { "data-testid": "world-model-graph" })
}));

function belief(input: Partial<BeliefRecord> = {}): BeliefRecord {
  const createdAt = new Date("2026-06-11T07:00:00.000Z");
  return {
    id: "belief_ai_agents",
    title: "AI agents",
    category: "AI_TREND",
    description: "Track whether AI agents improve delivery.",
    probabilityMode: "INDEPENDENT",
    origin: "INTERNAL",
    status: "ACTIVE",
    createdAt,
    updatedAt: createdAt,
    hypotheses: [],
    ...input
  };
}

function observation(input: Partial<ObservationRecord> = {}): ObservationRecord {
  return {
    id: "observation_unmatched",
    title: "Agent adoption signal",
    content: "Teams report that agent adoption changes delivery quality.",
    observedAt: new Date("2026-06-11T08:00:00.000Z"),
    status: "UNKNOWN",
    credibility: 0.72,
    metadata: {
      ignoredReason: "UNMATCHED"
    },
    ...input
  };
}

describe("world model beliefs page", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    loadWorldModelData.mockReset();
    recommendHypotheses.mockReset();
  });

  it("requests external beliefs when the external query toggle is enabled", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief({ origin: "EXTERNAL", title: "External belief" })],
      observations: [],
      evidence: [],
      updates: []
    });
    recommendHypotheses.mockResolvedValue([]);
    const { default: BeliefsPage } = await import("@/app/admin/world-model/beliefs/page");

    const html = renderToStaticMarkup(await BeliefsPage({ searchParams: Promise.resolve({ external: "1" }) }));

    expect(loadWorldModelData).toHaveBeenCalledWith({ includeExternalBeliefs: true });
    expect(html).toContain("External belief");
    expect(html).toContain("外部");
    expect(html).toContain('href="/admin/world-model/beliefs"');
  });

  it("shows the source observation for observation-driven hypothesis recommendations", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [observation()],
      evidence: [],
      updates: []
    });
    recommendHypotheses.mockResolvedValue([
      {
        proposition: "Agent adoption signal 持续影响「AI agents」",
        stance: "SUPPORTS",
        priorProbability: 0.45,
        notes: "可观察：跟踪这条未匹配观察。",
        evidenceSearchQuery: "AI agents Agent adoption signal",
        rationale: "来自未匹配观察：Agent adoption signal",
        sourceObservationId: "observation_unmatched"
      }
    ]);
    const { default: BeliefsPage } = await import("@/app/admin/world-model/beliefs/page");

    const html = renderToStaticMarkup(await BeliefsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("来源观察");
    expect(html).toContain("O-001");
    expect(html).toContain("Agent adoption signal");
    expect(html).toContain('name="evidenceSearchQuery" value="AI agents Agent adoption signal"');
    expect(html).toContain("搜证查询");
    expect(html).toContain('href="/admin/world-model/observations#unknown-evidence"');
  });

  it("shows calibration source details for calibration repair recommendations", async () => {
    const createdAt = new Date("2026-06-11T07:00:00.000Z");
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [
        belief({
          hypotheses: [
            {
              id: "hypothesis_miss",
              beliefId: "belief_ai_agents",
              proposition: "AI agents finish delivery this quarter",
              notes: "",
              stance: "SUPPORTS",
              priorProbability: 0.84,
              currentProbability: 0.84,
              strength: 0.84,
              status: "RESOLVED_FALSE",
              resolvedOutcome: "Delivery slipped into the next quarter.",
              createdAt,
              updatedAt: createdAt
            }
          ]
        })
      ],
      observations: [],
      evidence: [],
      updates: []
    });
    recommendHypotheses.mockResolvedValue([
      {
        proposition: "导致「AI agents finish delivery this quarter」被证伪的条件仍可能复现",
        stance: "OPPOSES",
        priorProbability: 0.35,
        notes: "可观察：复盘被证伪假设的触发条件。",
        evidenceSearchQuery: "AI agents finish delivery this quarter delay",
        rationale: "校准偏差：结算为未发生。",
        calibrationHypothesisId: "hypothesis_miss",
        calibrationError: 0.84
      }
    ]);
    const { default: BeliefsPage } = await import("@/app/admin/world-model/beliefs/page");

    const html = renderToStaticMarkup(await BeliefsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("校准来源");
    expect(html).toContain("H-001");
    expect(html).toContain("误差 84.0pp");
  });

  it("focuses recommendations by source observation code", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [
        belief({ id: "belief_ai_agents", title: "AI agents", createdAt: new Date("2026-06-11T07:00:00.000Z") }),
        belief({ id: "belief_career", title: "Career focus", category: "CAREER", createdAt: new Date("2026-06-11T07:01:00.000Z") })
      ],
      observations: [observation()],
      evidence: [],
      updates: []
    });
    recommendHypotheses.mockImplementation(async (beliefId: string) =>
      beliefId === "belief_ai_agents"
        ? [
            {
              proposition: "Agent adoption signal 持续影响「AI agents」",
              stance: "SUPPORTS",
              priorProbability: 0.45,
              notes: "可观察：跟踪这条未匹配观察。",
              evidenceSearchQuery: "AI agents Agent adoption signal",
              rationale: "来自未匹配观察：Agent adoption signal",
              sourceObservationId: "observation_unmatched"
            }
          ]
        : [
            {
              proposition: "Generic career recommendation",
              stance: "OPPOSES",
              priorProbability: 0.35,
              notes: "可观察：机会成本。",
              evidenceSearchQuery: "Career focus opportunity cost",
              rationale: "通用模板"
            }
          ]
    );
    const { default: BeliefsPage } = await import("@/app/admin/world-model/beliefs/page");

    const html = renderToStaticMarkup(
      await BeliefsPage({ searchParams: Promise.resolve({ sourceObservation: "O-001" }) })
    );

    expect(html).toContain("来源观察推荐");
    expect(html).toContain("Agent adoption signal 持续影响");
    expect(html).not.toContain("Generic career recommendation");
    expect(html).toContain('id="recommendations"');
  });

  it("requests source-observation scoped recommendations before applying the page limit", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief({ id: "belief_ai_agents", title: "AI agents", createdAt: new Date("2026-06-11T07:00:00.000Z") })],
      observations: [observation()],
      evidence: [],
      updates: []
    });
    recommendHypotheses.mockImplementation(async (_beliefId: string, options: { sourceObservationId?: string }) =>
      options.sourceObservationId === "observation_unmatched"
        ? [
            {
              proposition: "Agent adoption signal 持续影响「AI agents」",
              stance: "SUPPORTS",
              priorProbability: 0.45,
              notes: "可观察：跟踪这条未匹配观察。",
              evidenceSearchQuery: "AI agents Agent adoption signal",
              rationale: "来自未匹配观察：Agent adoption signal",
              sourceObservationId: "observation_unmatched"
            }
          ]
        : []
    );
    const { default: BeliefsPage } = await import("@/app/admin/world-model/beliefs/page");

    const html = renderToStaticMarkup(
      await BeliefsPage({ searchParams: Promise.resolve({ sourceObservation: "O-001" }) })
    );

    expect(recommendHypotheses).toHaveBeenCalledWith("belief_ai_agents", {
      limit: 4,
      sourceObservationId: "observation_unmatched"
    });
    expect(html).toContain("Agent adoption signal 持续影响");
    expect(html).not.toContain("暂无来自该观察的推荐");
  });

  it("prefills a new belief table from the focused source observation", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [observation()],
      evidence: [],
      updates: []
    });
    recommendHypotheses.mockResolvedValue([]);
    const { default: BeliefsPage } = await import("@/app/admin/world-model/beliefs/page");

    const html = renderToStaticMarkup(
      await BeliefsPage({ searchParams: Promise.resolve({ sourceObservation: "O-001" }) })
    );

    expect(html).toContain('type="hidden" name="sourceObservationId" value="observation_unmatched"');
    expect(html).toContain('name="title" value="Agent adoption signal"');
    expect(html).toContain("Teams report that agent adoption changes delivery quality.");
    expect(html).toContain('name="proposition1" value="Agent adoption signal 会持续影响这个判断"');
    expect(html).toContain('name="proposition2" value="Agent adoption signal 的影响有限或不可持续"');
  });

  it("shows a cognitive coverage gap for one-sided active hypotheses", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [
        belief({
          hypotheses: [
            {
              id: "hypothesis_support",
              beliefId: "belief_ai_agents",
              proposition: "AI agents improve delivery speed",
              notes: "",
              stance: "SUPPORTS",
              priorProbability: 0.45,
              currentProbability: 0.45,
              strength: 0.45,
              status: "ACTIVE",
              createdAt: new Date("2026-06-11T07:00:00.000Z"),
              updatedAt: new Date("2026-06-11T07:00:00.000Z")
            }
          ]
        })
      ],
      observations: [],
      evidence: [],
      updates: []
    });
    recommendHypotheses.mockResolvedValue([]);
    const { default: BeliefsPage } = await import("@/app/admin/world-model/beliefs/page");

    const html = renderToStaticMarkup(await BeliefsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("缺少反证假设");
    expect(html).toContain("当前有效假设只有支持方向");
  });

  it("keeps belief management focused on tables instead of embedding the graph", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [],
      evidence: [],
      updates: []
    });
    recommendHypotheses.mockResolvedValue([]);
    const { default: BeliefsPage } = await import("@/app/admin/world-model/beliefs/page");

    const html = renderToStaticMarkup(await BeliefsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("信念表");
    expect(html).not.toContain('data-testid="world-model-graph"');
  });
});
