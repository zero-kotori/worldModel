import { summarizeLlmEvaluation } from "@/server/training/llm-evaluation";
import type { TrainingSample } from "@/server/training/training-data";

function sample(label: TrainingSample["label"], source: TrainingSample["source"] = "fever"): TrainingSample {
  return {
    source,
    claim: `${source} ${label} claim`,
    evidence: `${source} ${label} evidence`,
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
        },
        {
          sample: sample("SUPPORTS"),
          llm: {
            estimator: "llm",
            direction: "SUPPORTS",
            likelihoodRatio: 2.1,
            confidence: 0.8,
            weight: 3,
            reviewRequired: true,
            abstain: false
          }
        }
      ],
      { modelName: "deepseek:deepseek-chat", lowConfidenceThreshold: 0.5 }
    );

    expect(summary.modelName).toBe("deepseek:deepseek-chat");
    expect(summary.sampleCount).toBe(4);
    expect(summary.scoredCount).toBe(3);
    expect(summary.sourceCounts).toEqual({ fever: 4 });
    expect(summary.directionAccuracy.SUPPORTS).toMatchObject({ total: 2, scored: 2, correct: 2, accuracy: 1 });
    expect(summary.directionAccuracy.OPPOSES).toMatchObject({ total: 1, scored: 1, correct: 0, accuracy: 0 });
    expect(summary.lowConfidenceCount).toBe(1);
    expect(summary.reviewRequiredCount).toBe(3);
    expect(summary.fallbackDivergenceRate).toBe(0.5);
    expect(summary.likelihoodRatio).toMatchObject({ min: 1.6, max: 2.2 });
  });

  it("reports source coverage so local confirmed samples are visible in evaluation artifacts", () => {
    const summary = summarizeLlmEvaluation(
      [
        {
          sample: sample("SUPPORTS", "local_confirmed"),
          llm: { estimator: "llm", direction: "SUPPORTS", likelihoodRatio: 2.2, confidence: 0.8, weight: 3, abstain: false }
        },
        {
          sample: sample("OPPOSES", "fever"),
          llm: { estimator: "llm", direction: "OPPOSES", likelihoodRatio: 0.4, confidence: 0.8, weight: 3, abstain: false }
        },
        {
          sample: sample("NEUTRAL", "climate_fever"),
          llm: { estimator: "llm", direction: "NEUTRAL", likelihoodRatio: 1, confidence: 0.8, weight: 3, abstain: false }
        }
      ],
      { modelName: "deepseek:deepseek-chat" }
    );

    expect(summary.sourceCounts).toEqual({
      climate_fever: 1,
      fever: 1,
      local_confirmed: 1
    });
  });

  it("does not count neutral fallback outputs as LLM fallback divergence", () => {
    const summary = summarizeLlmEvaluation(
      [
        {
          sample: sample("SUPPORTS"),
          llm: { estimator: "llm", direction: "SUPPORTS", likelihoodRatio: 2.2, confidence: 0.8, weight: 3, abstain: false },
          fallback: { estimator: "lightweight", direction: "NEUTRAL", likelihoodRatio: 1.1, confidence: 0.6, weight: 1, abstain: false }
        },
        {
          sample: sample("OPPOSES"),
          llm: { estimator: "llm", direction: "OPPOSES", likelihoodRatio: 0.4, confidence: 0.8, weight: 3, abstain: false },
          fallback: { estimator: "lightweight", direction: "SUPPORTS", likelihoodRatio: 1.8, confidence: 0.6, weight: 1, abstain: false }
        }
      ],
      { modelName: "deepseek:deepseek-chat" }
    );

    expect(summary.fallbackComparedCount).toBe(1);
    expect(summary.fallbackDivergenceCount).toBe(1);
    expect(summary.fallbackDivergenceRate).toBe(1);
  });
});
