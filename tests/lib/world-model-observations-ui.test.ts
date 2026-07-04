import {
  getObservationRecommendedLinks,
  groupObservationsForReview,
  observationCandidateEvaluationSummary,
  observationConversionSummary,
  observationIgnoredReasonLabel,
  observationRecommendedLinkLikelihoodSummary,
  observationQueryContextSummary,
  observationReviewPriority,
  observationReviewPriorityLabel,
  observationReviewReasonLabel,
  observationStatusLabels,
  summarizeObservationCandidateImpact
} from "@/lib/world-model-observations-ui";
import type { BeliefRecord, ObservationRecord } from "@/server/services/types";

function observation(
  id: string,
  status: ObservationRecord["status"],
  metadata: ObservationRecord["metadata"] = {}
): ObservationRecord {
  return {
    id,
    title: id,
    content: id,
    observedAt: new Date(`2026-06-09T00:0${id.length}:00.000Z`),
    status,
    credibility: 0.5,
    metadata
  };
}

function belief(input: {
  id: string;
  probabilityMode?: BeliefRecord["probabilityMode"];
  hypotheses: Array<{ id: string; currentProbability: number }>;
}): BeliefRecord {
  const createdAt = new Date("2026-06-09T08:00:00.000Z");
  return {
    id: input.id,
    title: input.id,
    category: "AI_TREND",
    description: "",
    probabilityMode: input.probabilityMode ?? "INDEPENDENT",
    origin: "INTERNAL",
    status: "ACTIVE",
    createdAt,
    updatedAt: createdAt,
    hypotheses: input.hypotheses.map((hypothesis) => ({
      id: hypothesis.id,
      beliefId: input.id,
      proposition: hypothesis.id,
      notes: "",
      stance: "SUPPORTS",
      priorProbability: hypothesis.currentProbability,
      currentProbability: hypothesis.currentProbability,
      strength: hypothesis.currentProbability,
      status: "ACTIVE",
      createdAt,
      updatedAt: createdAt
    }))
  };
}

describe("world model observations UI", () => {
  it("separates unknown observations and duplicate candidates for review", () => {
    const grouped = groupObservationsForReview([
      observation("pending", "PENDING"),
      observation("candidate", "PENDING", {
        recommendedLinks: [
          {
            hypothesisId: "hypothesis_1",
            direction: "SUPPORTS",
            relevance: 0.8,
            likelihoodRatio: 2,
            confidence: 0.7,
            rationale: "Candidate link"
          }
        ]
      }),
      observation("unknown", "UNKNOWN"),
      observation("duplicate", "DUPLICATE"),
      observation("confirmed", "CONFIRMED"),
      observation("settled", "SETTLED")
    ]);

    expect(grouped.unknown.map((item) => item.id)).toEqual(["unknown"]);
    expect(grouped.duplicates.map((item) => item.id)).toEqual(["duplicate"]);
    expect(grouped.activePool.map((item) => item.id)).toEqual(["pending"]);
    expect(grouped.reviewCandidates.map((item) => item.id)).toEqual(["candidate"]);
    expect(observationStatusLabels.UNKNOWN).toBe("未知证据");
    expect(observationStatusLabels.DUPLICATE).toBe("重复候选");
    expect(observationStatusLabels.SETTLED).toBe("已结算");
  });

  it("labels observations ignored by low-impact filtering", () => {
    expect(observationIgnoredReasonLabel("LOW_IMPACT")).toBe("低影响过滤");
    expect(observationIgnoredReasonLabel("UNMATCHED")).toBe("未匹配假设");
    expect(observationIgnoredReasonLabel("OTHER")).toBe("");
  });

  it("labels observations requeued after new hypothesis matching", () => {
    expect(observationReviewReasonLabel("REVIEW_ONLY")).toBe("待审模式");
    expect(observationReviewReasonLabel("SOURCE_REQUIRES_REVIEW")).toBe("来源待审");
    expect(observationReviewReasonLabel("ONE_SIDED_HYPOTHESIS_COVERAGE")).toBe("假设覆盖单向");
    expect(observationReviewReasonLabel("LLM_REVIEW_REQUIRED")).toBe("LLM 要求复核");
    expect(observationReviewReasonLabel("NEW_HYPOTHESIS_MATCH")).toBe("新增假设匹配");
    expect(observationReviewReasonLabel("RECOMMENDED_HYPOTHESIS_CREATED")).toBe("推荐假设已创建");
    expect(observationReviewReasonLabel("SETTLEMENT_REVIEW")).toBe("结算复盘");
    expect(observationReviewReasonLabel("OBSERVATION_EDIT")).toBe("编辑后重算");
    expect(observationReviewReasonLabel("OTHER")).toBe("待审队列");
  });

  it("summarizes recommendation conversion targets for requeued observations", () => {
    expect(
      observationConversionSummary(
        observation("converted", "PENDING", {
          convertedFromRecommendation: true,
          convertedBeliefId: "belief_1",
          convertedHypothesisIds: ["hypothesis_1", "hypothesis_2"]
        }),
        {
          beliefLabel: (id) => (id === "belief_1" ? "B-001" : id),
          hypothesisLabel: (id) => (id === "hypothesis_1" ? "H-001" : id === "hypothesis_2" ? "H-002" : id)
        }
      )
    ).toBe("推荐转入 B-001 · H-001、H-002");

    expect(observationConversionSummary(observation("plain", "PENDING"))).toBe("");
  });

  it("summarizes candidate evaluation diagnostics for unmatched observations", () => {
    expect(
      observationCandidateEvaluationSummary(
        observation("llm-abstain", "UNKNOWN", {
          ignoredReason: "UNMATCHED",
          candidateEvaluation: {
            estimator: "llm",
            attemptedCount: 3,
            usableCount: 0,
            abstainedCount: 2,
            rejectedCount: 1,
            latestRationale: "LLM scorer is temporarily unavailable."
          }
        })
      )
    ).toBe("llm 评估 3 个候选，0 个可用，2 个弃权，1 个低相关；LLM scorer is temporarily unavailable.");

    expect(observationCandidateEvaluationSummary(observation("plain", "UNKNOWN"))).toBe("");
  });

  it("summarizes the generated query context for sourced observations", () => {
    expect(
      observationQueryContextSummary(
        observation("query", "PENDING", {
          query: "AI agents engineering teams adoption",
          queryBeliefCode: "B-001",
          queryHypothesisCode: "H-001",
          queryPriority: 0.74,
          queryPriorityReason: "high uncertainty; no active evidence"
        })
      )
    ).toBe("搜证目标 H-001 · B-001；优先级 0.74；high uncertainty; no active evidence；查询：AI agents engineering teams adoption");

    expect(observationQueryContextSummary(observation("plain", "PENDING"))).toBe("");
  });

  it("keeps settlement review observations in the review queue even without evidence links", () => {
    const settlement = observation("settlement", "PENDING", {
      reviewReason: "SETTLEMENT_REVIEW",
      queryPurpose: "SETTLEMENT_REVIEW",
      queryBeliefCode: "B-001",
      queryHypothesisCode: "H-001",
      queryPriority: 1,
      queryPriorityReason: "settlement review due",
      query: "Governance pilot final outcome"
    });
    const plain = observation("plain", "PENDING");

    const grouped = groupObservationsForReview([plain, settlement]);

    expect(grouped.reviewCandidates.map((item) => item.id)).toEqual(["settlement"]);
    expect(grouped.activePool.map((item) => item.id)).toEqual(["plain"]);
    expect(observationQueryContextSummary(settlement)).toBe(
      "结算目标 H-001 · B-001；优先级 1.00；settlement review due；查询：Governance pilot final outcome"
    );
  });

  it("reads valid recommended links from observation metadata", () => {
    const candidate = observation("candidate", "PENDING", {
      recommendedLinks: [
        {
          hypothesisId: "hypothesis_1",
          direction: "OPPOSES",
          relevance: 0.6,
          likelihoodRatio: 0.5,
          confidence: 0.7,
          rationale: "Weakens the hypothesis"
        },
        {
          hypothesisId: "",
          direction: "SUPPORTS",
          relevance: "high",
          likelihoodRatio: 2,
          confidence: 0.7,
          rationale: "Invalid link"
        }
      ]
    });

    expect(getObservationRecommendedLinks(candidate)).toEqual([
      {
        hypothesisId: "hypothesis_1",
        direction: "OPPOSES",
        relevance: 0.6,
        likelihoodRatio: 0.5,
        confidence: 0.7,
        rationale: "Weakens the hypothesis"
      }
    ]);
  });

  it("preserves LLM review-required metadata on recommended links", () => {
    const candidate = observation("review-required", "PENDING", {
      recommendedLinks: [
        {
          hypothesisId: "hypothesis_review",
          direction: "SUPPORTS",
          relevance: 0.91,
          likelihoodRatio: 2.4,
          confidence: 0.88,
          rationale: "LLM requires source attribution review.",
          reviewRequired: true,
          estimatorOutputs: [
            {
              estimator: "llm",
              direction: "SUPPORTS",
              relevance: 0.91,
              likelihoodRatio: 2.4,
              confidence: 0.88,
              weight: 3,
              rationale: "LLM requires source attribution review.",
              reviewRequired: true,
              modelVersion: "deepseek:deepseek-chat"
            }
          ]
        }
      ]
    });

    expect(getObservationRecommendedLinks(candidate)).toEqual([
      {
        hypothesisId: "hypothesis_review",
        direction: "SUPPORTS",
        relevance: 0.91,
        likelihoodRatio: 2.4,
        confidence: 0.88,
        rationale: "LLM requires source attribution review.",
        reviewRequired: true,
        estimatorOutputs: [
          {
            estimator: "llm",
            direction: "SUPPORTS",
            relevance: 0.91,
            likelihoodRatio: 2.4,
            confidence: 0.88,
            weight: 3,
            rationale: "LLM requires source attribution review.",
            reviewRequired: true,
            modelVersion: "deepseek:deepseek-chat"
          }
        ]
      }
    ]);
  });

  it("labels effective and raw likelihood ratios when scorer output was reduced", () => {
    const [link] = getObservationRecommendedLinks(
      observation("reduced-lr", "PENDING", {
        recommendedLinks: [
          {
            hypothesisId: "hypothesis_review",
            direction: "SUPPORTS",
            relevance: 0.95,
            likelihoodRatio: 2,
            confidence: 0.7,
            rationale: "Aggregator claim requires review.",
            reviewRequired: true,
            estimatorOutputs: [
              {
                estimator: "llm",
                direction: "SUPPORTS",
                relevance: 0.95,
                likelihoodRatio: 20,
                confidence: 0.7,
                weight: 3,
                rationale: "Raw LLM score was high.",
                reviewRequired: true,
                modelVersion: "deepseek:deepseek-v4-flash"
              }
            ]
          }
        ]
      })
    );

    expect(observationRecommendedLinkLikelihoodSummary(link)).toBe("有效 LR 2.00 · 原始 LR 20.00");
  });

  it("prioritizes review candidates by likely belief impact", () => {
    const lowImpact = observation("low-impact", "PENDING", {
      recommendedLinks: [
        {
          hypothesisId: "hypothesis_low",
          direction: "SUPPORTS",
          relevance: 0.5,
          likelihoodRatio: 1.1,
          confidence: 0.5,
          rationale: "Small update"
        }
      ]
    });
    lowImpact.credibility = 0.5;

    const highImpact = observation("high-impact", "PENDING", {
      recommendedLinks: [
        {
          hypothesisId: "hypothesis_high",
          direction: "OPPOSES",
          relevance: 0.9,
          likelihoodRatio: 0.25,
          confidence: 0.9,
          rationale: "Large update"
        }
      ]
    });
    highImpact.credibility = 0.9;

    const grouped = groupObservationsForReview([lowImpact, highImpact]);

    expect(grouped.reviewCandidates.map((item) => item.id)).toEqual(["high-impact", "low-impact"]);
    expect(observationReviewPriority(highImpact)).toBeGreaterThan(observationReviewPriority(lowImpact));
    expect(observationReviewPriorityLabel(observationReviewPriority(highImpact))).toBe("高优先级");
    expect(observationReviewPriorityLabel(observationReviewPriority(lowImpact))).toBe("低优先级");
  });

  it("orders pending observations without recommendations by credibility and recency", () => {
    const olderLowCredibility = observation("older-low", "PENDING");
    olderLowCredibility.credibility = 0.4;
    olderLowCredibility.observedAt = new Date("2026-06-09T08:00:00.000Z");

    const newerLowCredibility = observation("newer-low", "PENDING");
    newerLowCredibility.credibility = 0.4;
    newerLowCredibility.observedAt = new Date("2026-06-09T10:00:00.000Z");

    const olderHighCredibility = observation("older-high", "PENDING");
    olderHighCredibility.credibility = 0.8;
    olderHighCredibility.observedAt = new Date("2026-06-09T07:00:00.000Z");

    const grouped = groupObservationsForReview([olderLowCredibility, newerLowCredibility, olderHighCredibility]);

    expect(grouped.activePool.map((item) => item.id)).toEqual(["older-high", "newer-low", "older-low"]);
  });

  it("orders reviewable low-impact unknown observations before plain unknown observations", () => {
    const plainUnknown = observation("plain-unknown", "UNKNOWN");
    plainUnknown.observedAt = new Date("2026-06-09T12:00:00.000Z");
    const lowImpact = observation("low-impact", "UNKNOWN", {
      ignoredReason: "LOW_IMPACT",
      recommendedLinks: [
        {
          hypothesisId: "hypothesis_low",
          direction: "SUPPORTS",
          relevance: 0.4,
          likelihoodRatio: 1.2,
          confidence: 0.5,
          rationale: "Small but reviewable update"
        }
      ]
    });
    lowImpact.observedAt = new Date("2026-06-09T09:00:00.000Z");
    const strongerLowImpact = observation("stronger-low-impact", "UNKNOWN", {
      ignoredReason: "LOW_IMPACT",
      recommendedLinks: [
        {
          hypothesisId: "hypothesis_high",
          direction: "OPPOSES",
          relevance: 0.9,
          likelihoodRatio: 0.45,
          confidence: 0.8,
          rationale: "Still below automatic impact threshold"
        }
      ]
    });
    strongerLowImpact.observedAt = new Date("2026-06-09T08:00:00.000Z");

    const grouped = groupObservationsForReview([plainUnknown, lowImpact, strongerLowImpact]);

    expect(grouped.unknown.map((item) => item.id)).toEqual(["stronger-low-impact", "low-impact", "plain-unknown"]);
    expect(getObservationRecommendedLinks(grouped.unknown[0])).toHaveLength(1);
  });

  it("summarizes the largest expected probability change for a review candidate", () => {
    const candidate = observation("candidate", "PENDING", {
      recommendedLinks: [
        {
          hypothesisId: "hypothesis_1",
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 2,
          confidence: 0.7,
          rationale: "Raises expected adoption."
        }
      ]
    });
    candidate.credibility = 0.8;

    expect(
      summarizeObservationCandidateImpact(
        candidate,
        [belief({ id: "belief_1", hypotheses: [{ id: "hypothesis_1", currentProbability: 0.4 }] })],
        (id) => (id === "hypothesis_1" ? "H-001" : id)
      )
    ).toEqual({
      label: "+14.5pp",
      detail: "H-001 40.0% -> 54.5%",
      tone: "increase"
    });
  });

  it("summarizes review candidates without valid links as having no preview", () => {
    expect(summarizeObservationCandidateImpact(observation("plain", "PENDING"), [])).toEqual({
      label: "无预览",
      detail: "没有可确认的推荐关联。",
      tone: "neutral"
    });
  });
});
