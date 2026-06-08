import {
  createExternalModelEstimator,
  createLightweightEstimator,
  createLlmEstimator
} from "@/server/models/estimators";

describe("likelihood estimators", () => {
  it("calls an OpenAI-compatible chat completions API and parses structured likelihood output", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown>; authorization: string | null }> = [];
    const fakeFetch: typeof fetch = async (url, init) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        authorization: new Headers(init?.headers).get("authorization")
      });
      return new Response(
        JSON.stringify({
          model: "deepseek-chat",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  direction: "SUPPORTS",
                  relevance: 0.86,
                  likelihoodRatio: 2.4,
                  confidence: 0.78,
                  rationale: "The evidence semantically supports the hypothesis."
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const llm = createLlmEstimator({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-chat",
      fetch: fakeFetch
    });

    const output = await llm.estimate({
      evidenceText: "Enterprise adoption increased after agents shipped.",
      hypothesis: "AI agents accelerate enterprise engineering teams",
      category: "AI_TREND",
      sourceCredibility: 0.8
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(requests[0].authorization).toBe("Bearer test-key");
    expect(requests[0].body).toMatchObject({
      model: "deepseek-chat",
      response_format: { type: "json_object" }
    });
    expect(output).toMatchObject({
      estimator: "llm",
      likelihoodRatio: 2.4,
      confidence: 0.78,
      weight: 3,
      rationale: "The evidence semantically supports the hypothesis.",
      modelVersion: "deepseek:deepseek-chat",
      abstain: false
    });
  });

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
