import { summarizeLlmEvaluation } from "@/server/training/llm-evaluation";
import type { TrainingSample } from "@/server/training/training-data";

function sample(label: TrainingSample["label"]): TrainingSample {
  return {
    source: "fever",
    claim: `${label} claim`,
    evidence: `${label} evidence`,
    label,
    relevance: 0.8,
    likelihoodRatio: label === "SUPPORTS" ? 2.5 : label === "OPPOSES" ? 0.4 : 1,
    confidence: 0.8,
    provenance: { dataset: "test", split: "unit", sourceId: label }
  };
}

describe("LLM likelihood evaluation summary", () => {
  it("reports direction accuracy, review rates, likelihood distribution, and fallback divergence", () => {
    const summary = summarizeLlmEvaluation(
      [
        {
          sample: sample("SUPPORTS"),
          llm: { estimator: "llm", direction: "SUPPORTS", likelihoodRatio: 2.2, confidence: 0.8, weight: 3, abstain: false },
          fallback: { estimator: "lightweight", direction: "SUPPORTS", likelihoodRatio: 1.8, confidence: 0.6, weight: 1, abstain: false }
        },
        {
          sample: sample("OPPOSES"),
          llm: { estimator: "llm", direction: "SUPPORTS", likelihoodRatio: 1.6, confidence: 0.4, weight: 3, abstain: false },
          fallback: { estimator: "lightweight", direction: "OPPOSES", likelihoodRatio: 0.6, confidence: 0.7, weight: 1, abstain: false }
        },
        {
          sample: sample("NEUTRAL"),
          llm: { estimator: "llm", weight: 3, abstain: true, rationale: "No score." }
        }
      ],
      { modelName: "deepseek:deepseek-chat", lowConfidenceThreshold: 0.5 }
    );

    expect(summary.modelName).toBe("deepseek:deepseek-chat");
    expect(summary.sampleCount).toBe(3);
    expect(summary.scoredCount).toBe(2);
    expect(summary.directionAccuracy.SUPPORTS).toMatchObject({ total: 1, scored: 1, correct: 1, accuracy: 1 });
    expect(summary.directionAccuracy.OPPOSES).toMatchObject({ total: 1, scored: 1, correct: 0, accuracy: 0 });
    expect(summary.lowConfidenceCount).toBe(1);
    expect(summary.reviewRequiredCount).toBe(2);
    expect(summary.fallbackDivergenceRate).toBe(0.5);
    expect(summary.likelihoodRatio).toMatchObject({ min: 1.6, max: 2.2 });
  });
});
