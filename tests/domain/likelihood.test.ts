import { combineEstimatorOutputs } from "@/domain/likelihood";

describe("likelihood estimator ensemble", () => {
  it("combines weighted estimator outputs in log likelihood space", () => {
    const ensemble = combineEstimatorOutputs([
      { estimator: "lightweight", likelihoodRatio: 2, confidence: 0.8, weight: 2, rationale: "feature match" },
      { estimator: "llm", likelihoodRatio: 4, confidence: 0.6, weight: 1, rationale: "semantic support" }
    ]);

    expect(ensemble.reviewRequired).toBe(false);
    expect(ensemble.likelihoodRatio).toBeGreaterThan(2);
    expect(ensemble.likelihoodRatio).toBeLessThan(4);
    expect(ensemble.confidence).toBeCloseTo((1.6 + 0.6) / 3, 8);
  });

  it("ignores abstained and invalid estimators", () => {
    const ensemble = combineEstimatorOutputs([
      { estimator: "external", weight: 10, abstain: true, rationale: "artifact missing" },
      { estimator: "llm", likelihoodRatio: 3, confidence: 0.5, weight: 1, rationale: "usable" }
    ]);

    expect(ensemble.reviewRequired).toBe(false);
    expect(ensemble.likelihoodRatio).toBeCloseTo(3, 8);
    expect(ensemble.usedEstimators).toEqual(["llm"]);
  });

  it("requires review when every estimator abstains", () => {
    const ensemble = combineEstimatorOutputs([
      { estimator: "lightweight", weight: 1, abstain: true },
      { estimator: "llm", weight: 1, abstain: true }
    ]);

    expect(ensemble.reviewRequired).toBe(true);
    expect(ensemble.likelihoodRatio).toBe(1);
    expect(ensemble.confidence).toBe(0);
  });
});
