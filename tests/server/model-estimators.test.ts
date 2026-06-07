import {
  createExternalModelEstimator,
  createLightweightEstimator,
  createLlmEstimator
} from "@/server/models/estimators";

describe("likelihood estimators", () => {
  it("uses transparent lightweight features when an artifact is available", async () => {
    const estimator = createLightweightEstimator({
      version: "0.1.0",
      supportTerms: ["adoption", "demand"],
      opposeTerms: ["delay"]
    });

    const output = await estimator.estimate({
      evidenceText: "Enterprise adoption and demand increased.",
      hypothesis: "AI tooling adoption accelerates",
      category: "AI_TREND",
      sourceCredibility: 0.8
    });

    expect(output.abstain).toBe(false);
    expect(output.likelihoodRatio).toBeGreaterThan(1);
    expect(output.rationale).toContain("support terms");
  });

  it("abstains lightweight estimation without an artifact", async () => {
    const estimator = createLightweightEstimator(null);

    await expect(
      estimator.estimate({
        evidenceText: "Anything",
        hypothesis: "A hypothesis",
        category: "AI_TREND",
        sourceCredibility: 0.5
      })
    ).resolves.toMatchObject({ abstain: true, estimator: "lightweight" });
  });

  it("abstains LLM and external adapters when configuration is missing", async () => {
    const llm = createLlmEstimator({ provider: "openai" });
    const external = createExternalModelEstimator({});
    const input = {
      evidenceText: "Evidence",
      hypothesis: "Hypothesis",
      category: "TECH_TREND" as const,
      sourceCredibility: 0.5
    };

    await expect(llm.estimate(input)).resolves.toMatchObject({ abstain: true, estimator: "llm" });
    await expect(external.estimate(input)).resolves.toMatchObject({ abstain: true, estimator: "external-deep-model" });
  });
});
