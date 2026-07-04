import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
import type { BeliefRecord, ObservationRecord } from "@/server/services/types";

const loadWorldModelData = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/app/admin/world-model/data", () => ({
  loadWorldModelData
}));

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

function belief(): BeliefRecord {
  const createdAt = new Date("2026-06-11T07:00:00.000Z");
  return {
    id: "belief_agent_adoption",
    title: "Agent adoption",
    category: "AI_TREND",
    description: "Track agent adoption.",
    probabilityMode: "INDEPENDENT",
    status: "ACTIVE",
    createdAt,
    updatedAt: createdAt,
    hypotheses: [
      {
        id: "hypothesis_agent_support",
        beliefId: "belief_agent_adoption",
        proposition: "Agent adoption improves delivery quality.",
        notes: "",
        stance: "SUPPORTS",
        priorProbability: 0.45,
        currentProbability: 0.45,
        strength: 0.45,
        status: "ACTIVE",
        createdAt,
        updatedAt: createdAt
      },
      {
        id: "hypothesis_agent_oppose",
        beliefId: "belief_agent_adoption",
        proposition: "Agent adoption does not improve delivery quality.",
        notes: "",
        stance: "OPPOSES",
        priorProbability: 0.35,
        currentProbability: 0.35,
        strength: 0.35,
        status: "ACTIVE",
        createdAt: new Date("2026-06-11T07:05:00.000Z"),
        updatedAt: createdAt
      }
    ]
  };
}

describe("world model observations page", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    loadWorldModelData.mockReset();
  });

  it("anchors pending observations for automation follow-up actions", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [],
      observations: [
        {
          id: "observation_pending",
          title: "Pending source observation",
          content: "Pending source observation content",
          observedAt: new Date("2026-06-11T08:00:00.000Z"),
          status: "PENDING",
          credibility: 0.7,
          metadata: {}
        }
      ],
      evidence: [],
      updates: []
    });
    const { default: ObservationsPage } = await import("@/app/admin/world-model/observations/page");

    const html = renderToStaticMarkup(await ObservationsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('id="pending-observations"');
    expect(html).toContain("Pending source observation");
  });

  it("links unmatched observations to source-focused hypothesis recommendations", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [],
      observations: [observation()],
      evidence: [],
      updates: []
    });
    const { default: ObservationsPage } = await import("@/app/admin/world-model/observations/page");

    const html = renderToStaticMarkup(await ObservationsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("推荐假设");
    expect(html).toContain('href="/admin/world-model/beliefs?sourceObservation=O-001#recommendations"');
  });

  it("shows the recommendation conversion target for requeued review candidates", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [
        observation({
          status: "PENDING",
          metadata: {
            reviewReason: "RECOMMENDED_HYPOTHESIS_CREATED",
            convertedFromRecommendation: true,
            convertedBeliefId: "belief_agent_adoption",
            convertedHypothesisIds: ["hypothesis_agent_support", "hypothesis_agent_oppose"],
            recommendedLinks: [
              {
                hypothesisId: "hypothesis_agent_support",
                direction: "SUPPORTS",
                relevance: 0.8,
                likelihoodRatio: 2,
                confidence: 0.7,
                rationale: "Recommendation created from this observation."
              }
            ]
          }
        })
      ],
      evidence: [],
      updates: []
    });
    const { default: ObservationsPage } = await import("@/app/admin/world-model/observations/page");

    const html = renderToStaticMarkup(await ObservationsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("推荐假设已创建");
    expect(html).toContain("推荐转入 B-001 · H-001、H-002");
  });

  it("shows candidate evaluation diagnostics for unmatched observations", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [],
      observations: [
        observation({
          status: "UNKNOWN",
          metadata: {
            ignoredReason: "UNMATCHED",
            candidateEvaluation: {
              estimator: "llm",
              attemptedCount: 1,
              usableCount: 0,
              abstainedCount: 1,
              rejectedCount: 0,
              latestRationale: "LLM scorer is temporarily unavailable."
            }
          }
        })
      ],
      evidence: [],
      updates: []
    });
    const { default: ObservationsPage } = await import("@/app/admin/world-model/observations/page");

    const html = renderToStaticMarkup(await ObservationsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("未匹配假设");
    expect(html).toContain("llm 评估 1 个候选，0 个可用，1 个弃权；LLM scorer is temporarily unavailable.");
  });

  it("lets operators bulk reject low-impact unknown observations without submitting unmatched observations", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [],
      observations: [
        observation({
          id: "observation_low_impact",
          title: "Low impact signal",
          status: "UNKNOWN",
          metadata: { ignoredReason: "LOW_IMPACT" }
        }),
        observation({
          id: "observation_low_impact_2",
          title: "Second low impact signal",
          status: "UNKNOWN",
          metadata: { ignoredReason: "LOW_IMPACT" }
        }),
        observation({
          id: "observation_unmatched",
          title: "Unmatched signal",
          status: "UNKNOWN",
          metadata: { ignoredReason: "UNMATCHED" }
        })
      ],
      evidence: [],
      updates: []
    });
    const { default: ObservationsPage } = await import("@/app/admin/world-model/observations/page");

    const html = renderToStaticMarkup(await ObservationsPage({ searchParams: Promise.resolve({}) }));
    const unknownSection = html.slice(html.indexOf('id="unknown-evidence"'), html.indexOf('id="duplicate-candidates"'));
    const lowImpactForm = unknownSection.slice(0, unknownSection.indexOf("拒绝全部低影响观察"));

    expect(unknownSection).toContain("拒绝全部低影响观察");
    expect(unknownSection).toContain("删除全部低影响观察");
    expect(lowImpactForm).toContain('name="returnPath" value="/admin/world-model/observations#unknown-evidence"');
    expect(lowImpactForm).toContain('name="observationIds" value="observation_low_impact"');
    expect(lowImpactForm).toContain('name="observationIds" value="observation_low_impact_2"');
    expect(lowImpactForm).not.toContain('name="observationIds" value="observation_unmatched"');
  });

  it("lets operators reject every observation currently in the unknown evidence queue", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [],
      observations: [
        observation({
          id: "observation_low_impact",
          title: "Low impact signal",
          status: "UNKNOWN",
          metadata: { ignoredReason: "LOW_IMPACT" }
        }),
        observation({
          id: "observation_unmatched",
          title: "Unmatched signal",
          status: "UNKNOWN",
          metadata: { ignoredReason: "UNMATCHED" }
        }),
        observation({
          id: "observation_pending",
          title: "Pending signal",
          status: "PENDING",
          metadata: {}
        })
      ],
      evidence: [],
      updates: []
    });
    const { default: ObservationsPage } = await import("@/app/admin/world-model/observations/page");

    const html = renderToStaticMarkup(await ObservationsPage({ searchParams: Promise.resolve({}) }));
    const unknownSection = html.slice(html.indexOf('id="unknown-evidence"'), html.indexOf('id="duplicate-candidates"'));

    expect(unknownSection).toContain("拒绝全部未知证据");
    expect(unknownSection).toContain("删除全部未知证据");
    expect(unknownSection).toContain('name="returnPath" value="/admin/world-model/observations#unknown-evidence"');
    expect(unknownSection).toContain('name="observationIds" value="observation_low_impact"');
    expect(unknownSection).toContain('name="observationIds" value="observation_unmatched"');
    expect(unknownSection).not.toContain('name="observationIds" value="observation_pending"');
  });

  it("shows candidate evaluation diagnostics for review candidates with recommended links", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [
        observation({
          status: "PENDING",
          metadata: {
            reviewReason: "QUALITY_THRESHOLD",
            candidateEvaluation: {
              estimator: "llm",
              attemptedCount: 2,
              usableCount: 1,
              abstainedCount: 0,
              rejectedCount: 1,
              latestRationale: "One candidate was relevant enough for review."
            },
            recommendedLinks: [
              {
                hypothesisId: "hypothesis_agent_support",
                direction: "SUPPORTS",
                relevance: 0.83,
                likelihoodRatio: 1.8,
                confidence: 0.31,
                rationale: "The evidence is relevant but too uncertain for automatic application."
              }
            ]
          }
        })
      ],
      evidence: [],
      updates: []
    });
    const { default: ObservationsPage } = await import("@/app/admin/world-model/observations/page");

    const html = renderToStaticMarkup(await ObservationsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("阈值待审");
    expect(html).toContain("llm 评估 2 个候选，1 个可用，1 个低相关；One candidate was relevant enough for review.");
  });

  it("shows generated query context for review candidates", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [
        observation({
          status: "PENDING",
          metadata: {
            reviewReason: "QUALITY_THRESHOLD",
            query: "Agent adoption delivery quality",
            queryBeliefCode: "B-001",
            queryHypothesisCode: "H-001",
            queryPriority: 0.61,
            queryPriorityReason: "moderate uncertainty; no active evidence",
            recommendedLinks: [
              {
                hypothesisId: "hypothesis_agent_support",
                direction: "SUPPORTS",
                relevance: 0.83,
                likelihoodRatio: 1.8,
                confidence: 0.31,
                rationale: "The evidence is relevant but too uncertain for automatic application."
              }
            ]
          }
        })
      ],
      evidence: [],
      updates: []
    });
    const { default: ObservationsPage } = await import("@/app/admin/world-model/observations/page");

    const html = renderToStaticMarkup(await ObservationsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("搜证目标 H-001 · B-001；优先级 0.61；moderate uncertainty; no active evidence；查询：Agent adoption delivery quality");
  });

  it("shows settlement review observations as review candidates linked to the hypothesis graph", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [
        observation({
          status: "PENDING",
          metadata: {
            reviewReason: "SETTLEMENT_REVIEW",
            queryPurpose: "SETTLEMENT_REVIEW",
            query: "Agent adoption final outcome",
            queryBeliefCode: "B-001",
            queryHypothesisCode: "H-001",
            queryPriority: 1,
            queryPriorityReason: "settlement review due",
            settlementHypothesisId: "hypothesis_agent_support"
          }
        })
      ],
      evidence: [],
      updates: []
    });
    const { default: ObservationsPage } = await import("@/app/admin/world-model/observations/page");

    const html = renderToStaticMarkup(await ObservationsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("结算复盘");
    expect(html).toContain("结算目标 H-001 · B-001；优先级 1.00；settlement review due；查询：Agent adoption final outcome");
    expect(html).toContain("结算发生");
    expect(html).toContain("结算未发生");
    expect(html).toContain('name="outcome" value="RESOLVED_TRUE"');
    expect(html).toContain('name="outcome" value="RESOLVED_FALSE"');
    expect(html).toContain("结算假设");
    expect(html).toContain('href="/admin/world-model/graph?hypothesis=H-001"');
    expect(html).not.toContain("确认推荐");
  });

  it("shows one-sided hypothesis coverage as the review reason for candidates", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [
        observation({
          status: "PENDING",
          metadata: {
            reviewReason: "ONE_SIDED_HYPOTHESIS_COVERAGE",
            recommendedLinks: [
              {
                hypothesisId: "hypothesis_agent_support",
                direction: "SUPPORTS",
                relevance: 0.83,
                likelihoodRatio: 1.8,
                confidence: 0.78,
                rationale: "The evidence is relevant but the belief has only one hypothesis stance."
              }
            ]
          }
        })
      ],
      evidence: [],
      updates: []
    });
    const { default: ObservationsPage } = await import("@/app/admin/world-model/observations/page");

    const html = renderToStaticMarkup(await ObservationsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("假设覆盖单向");
  });

  it("links one-sided coverage review candidates to source-focused hypothesis recommendations", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [
        observation({
          status: "PENDING",
          metadata: {
            reviewReason: "ONE_SIDED_HYPOTHESIS_COVERAGE",
            recommendedLinks: [
              {
                hypothesisId: "hypothesis_agent_support",
                direction: "SUPPORTS",
                relevance: 0.83,
                likelihoodRatio: 1.8,
                confidence: 0.78,
                rationale: "The evidence is relevant but the belief has only one hypothesis stance."
              }
            ]
          }
        })
      ],
      evidence: [],
      updates: []
    });
    const { default: ObservationsPage } = await import("@/app/admin/world-model/observations/page");

    const html = renderToStaticMarkup(await ObservationsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("补假设");
    expect(html).toContain('href="/admin/world-model/beliefs?sourceObservation=O-001#recommendations"');
  });

  it("shows LLM-required review as the review reason for candidates", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [
        observation({
          status: "PENDING",
          metadata: {
            reviewReason: "LLM_REVIEW_REQUIRED",
            recommendedLinks: [
              {
                hypothesisId: "hypothesis_agent_support",
                direction: "SUPPORTS",
                relevance: 0.83,
                likelihoodRatio: 1.8,
                confidence: 0.78,
                rationale: "The LLM scorer marked this candidate for manual review."
              }
            ]
          }
        })
      ],
      evidence: [],
      updates: []
    });
    const { default: ObservationsPage } = await import("@/app/admin/world-model/observations/page");

    const html = renderToStaticMarkup(await ObservationsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("LLM 要求复核");
  });

  it("links duplicate candidates to their original observation row", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [],
      observations: [
        observation({
          id: "observation_original",
          title: "Original signal",
          observedAt: new Date("2026-06-11T08:00:00.000Z"),
          status: "PENDING",
          metadata: {}
        }),
        observation({
          id: "observation_duplicate",
          title: "Duplicate signal",
          observedAt: new Date("2026-06-11T09:00:00.000Z"),
          status: "DUPLICATE",
          duplicateOfId: "observation_original",
          metadata: {}
        }),
        observation({
          id: "observation_duplicate_2",
          title: "Second duplicate signal",
          observedAt: new Date("2026-06-11T10:00:00.000Z"),
          status: "DUPLICATE",
          duplicateOfId: "observation_original",
          metadata: {}
        })
      ],
      evidence: [],
      updates: []
    });
    const { default: ObservationsPage } = await import("@/app/admin/world-model/observations/page");

    const html = renderToStaticMarkup(await ObservationsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('id="duplicate-candidates"');
    expect(html).toContain('href="#O-001"');
    expect(html).toContain('id="O-001"');
    const duplicateSection = html.slice(html.indexOf('id="duplicate-candidates"'), html.indexOf('id="observation-pool"'));
    expect(duplicateSection).toContain("拒绝全部重复候选");
    expect(duplicateSection).toContain("删除全部重复候选");
    expect(duplicateSection).toContain('name="returnPath" value="/admin/world-model/observations#duplicate-candidates"');
    expect(duplicateSection).toContain('name="observationIds" value="observation_duplicate"');
    expect(duplicateSection).toContain('name="observationIds" value="observation_duplicate_2"');
    expect(duplicateSection).not.toContain('name="observationIds" value="observation_original"');
  });

  it("keeps the observation pool behind an explicit view link by default", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [],
      observations: [
        observation({
          id: "observation_editable",
          title: "Editable observation",
          content: "Original observation content.",
          status: "PENDING",
          url: "https://example.com/original",
          author: "Original source",
          metadata: {}
        })
      ],
      evidence: [],
      updates: []
    });
    const { default: ObservationsPage } = await import("@/app/admin/world-model/observations/page");

    const html = renderToStaticMarkup(await ObservationsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('id="observation-pool"');
    expect(html).toContain('href="/admin/world-model/observations?view=pool#observation-pool"');
    expect(html).toContain("打开观察池");
    expect(html).not.toContain("保存观察");
    expect(html).not.toContain('name="returnPath" value="/admin/world-model/observations?view=pool#observation-pool"');
  });

  it("lets operators edit observations from the explicit observation pool view", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [],
      observations: [
        observation({
          id: "observation_editable",
          title: "Editable observation",
          content: "Original observation content.",
          status: "PENDING",
          url: "https://example.com/original",
          author: "Original source",
          metadata: {}
        })
      ],
      evidence: [],
      updates: []
    });
    const { default: ObservationsPage } = await import("@/app/admin/world-model/observations/page");

    const html = renderToStaticMarkup(await ObservationsPage({ searchParams: Promise.resolve({ view: "pool" }) }));

    expect(html).toContain('id="observation-pool"');
    expect(html).toContain("收起观察池");
    expect(html).toContain("保存观察");
    expect(html).toContain('name="returnPath" value="/admin/world-model/observations?view=pool#observation-pool"');
    expect(html).toContain('name="observationId" value="observation_editable"');
    expect(html).toMatch(/<input[^>]*name="title"[^>]*value="Editable observation"/);
    expect(html).toMatch(/<input[^>]*name="url"[^>]*value="https:\/\/example\.com\/original"/);
    expect(html).toMatch(/<input[^>]*name="author"[^>]*value="Original source"/);
    expect(html).toMatch(/<input[^>]*name="credibility"[^>]*value="0.72"/);
    expect(html).toContain("Original observation content.");
  });
});
