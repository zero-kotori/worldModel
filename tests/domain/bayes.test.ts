import {
  normalizeMutuallyExclusive,
  updateIndependentHypothesis,
  updateMutuallyExclusiveHypotheses
} from "@/domain/bayes";

describe("Bayesian probability updates", () => {
  it("keeps an independent hypothesis unchanged for neutral likelihood", () => {
    expect(updateIndependentHypothesis(0.4, 1, 1)).toBeCloseTo(0.4, 8);
  });

  it("increases an independent hypothesis for positive evidence", () => {
    expect(updateIndependentHypothesis(0.4, 2, 1)).toBeGreaterThan(0.4);
  });

  it("discounts independent updates by source credibility", () => {
    const fullCredibility = updateIndependentHypothesis(0.4, 3, 1);
    const lowCredibility = updateIndependentHypothesis(0.4, 3, 0.25);

    expect(lowCredibility).toBeGreaterThan(0.4);
    expect(lowCredibility).toBeLessThan(fullCredibility);
  });

  it("normalizes mutually exclusive priors", () => {
    expect(normalizeMutuallyExclusive([2, 3, 5])).toEqual([0.2, 0.3, 0.5]);
  });

  it("keeps mutually exclusive posterior probabilities summed to one", () => {
    const posterior = updateMutuallyExclusiveHypotheses([0.2, 0.3, 0.5], [1.5, 1, 0.5], 0.8);

    expect(posterior.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 8);
  });

  it("moves posterior mass toward the stronger likelihood", () => {
    const posterior = updateMutuallyExclusiveHypotheses([0.5, 0.5], [3, 0.5], 1);

    expect(posterior[0]).toBeGreaterThan(0.5);
    expect(posterior[1]).toBeLessThan(0.5);
  });

  it("keeps a mutually exclusive distribution stable for neutral evidence", () => {
    const posterior = updateMutuallyExclusiveHypotheses([0.2, 0.3, 0.5], [1, 1, 1], 1);

    expect(posterior).toEqual([0.2, 0.3, 0.5]);
  });
});
