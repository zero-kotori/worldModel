import {
  getObservationRecommendedLinks,
  groupObservationsForReview,
  observationReviewPriority,
  observationReviewPriorityLabel,
  observationStatusLabels
} from "@/lib/world-model-observations-ui";
import type { ObservationRecord } from "@/server/services/types";

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
      observation("confirmed", "CONFIRMED")
    ]);

    expect(grouped.unknown.map((item) => item.id)).toEqual(["unknown"]);
    expect(grouped.duplicates.map((item) => item.id)).toEqual(["duplicate"]);
    expect(grouped.activePool.map((item) => item.id)).toEqual(["pending"]);
    expect(grouped.reviewCandidates.map((item) => item.id)).toEqual(["candidate"]);
    expect(observationStatusLabels.UNKNOWN).toBe("未知证据");
    expect(observationStatusLabels.DUPLICATE).toBe("重复候选");
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
});
