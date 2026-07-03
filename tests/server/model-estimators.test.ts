import {
  createConfiguredLlmEstimator,
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

  it("calls an external OpenAI-compatible deep model endpoint and parses likelihood output", async () => {
    const requests: Array<{ url: string; authorization: string | null; body: Record<string, unknown> }> = [];
    const fakeFetch: typeof fetch = async (url, init) => {
      requests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body))
      });
      return new Response(
        JSON.stringify({
          model: "deep-eval-v1",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  direction: "SUPPORTS",
                  relevance: 0.84,
                  likelihoodRatio: 2.6,
                  confidence: 0.73,
                  reviewRequired: false,
                  rationale: "The external model finds direct market evidence."
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const estimator = createExternalModelEstimator({
      endpoint: "https://models.example/v1",
      apiKey: "external-test-key",
      model: "deep-eval-v1",
      version: "2026-07-03",
      fetch: fakeFetch
    });

    const output = await estimator.estimate({
      evidenceText: "Polymarket odds moved after a verified event.",
      hypothesis: "The event is more likely after the market move",
      category: "AI_TREND",
      sourceCredibility: 0.8
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://models.example/v1/chat/completions");
    expect(requests[0].authorization).toBe("Bearer external-test-key");
    expect(requests[0].body).toMatchObject({
      model: "deep-eval-v1",
      response_format: { type: "json_object" }
    });
    expect(output).toMatchObject({
      estimator: "external-deep-model",
      direction: "SUPPORTS",
      relevance: 0.84,
      likelihoodRatio: 2.6,
      confidence: 0.73,
      weight: 2,
      modelVersion: "external-deep-model:2026-07-03",
      abstain: false
    });
  });

  it("uses DeepSeek defaults when only the v1 LLM API key is configured", async () => {
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
                  relevance: 0.8,
                  likelihoodRatio: 2,
                  confidence: 0.72,
                  rationale: "The configured API key can use the default DeepSeek scorer."
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const llm = createConfiguredLlmEstimator(
      {
        LLM_API_KEY: "test-key"
      },
      fakeFetch
    );

    const output = await llm.estimate({
      evidenceText: "AI coding agents shipped into production workflows.",
      hypothesis: "AI agents accelerate engineering teams",
      category: "AI_TREND",
      sourceCredibility: 0.8
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(requests[0].authorization).toBe("Bearer test-key");
    expect(requests[0].body).toMatchObject({ model: "deepseek-chat" });
    expect(output).toMatchObject({
      estimator: "llm",
      modelVersion: "deepseek:deepseek-chat",
      abstain: false
    });
  });

  it("parses explicit LLM review requirements from structured likelihood output", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
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
                  reviewRequired: true,
                  rationale: "The evidence is relevant, but source ambiguity needs human review."
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const llm = createLlmEstimator({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-chat",
      fetch: fakeFetch
    });

    await expect(
      llm.estimate({
        evidenceText: "Enterprise adoption increased after agents shipped.",
        hypothesis: "AI agents accelerate enterprise engineering teams",
        category: "AI_TREND",
        sourceCredibility: 0.8
      })
    ).resolves.toMatchObject({
      estimator: "llm",
      reviewRequired: true,
      abstain: false
    });
  });

  it("includes evidence timing context in the LLM likelihood prompt", async () => {
    const requests: Array<{ body: Record<string, unknown> }> = [];
    const fakeFetch: typeof fetch = async (_url, init) => {
      requests.push({ body: JSON.parse(String(init?.body)) });
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
                  reviewRequired: false,
                  rationale: "The time context is compatible with the hypothesis."
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

    await llm.estimate({
      evidenceText: "Enterprise adoption increased after agents shipped.",
      hypothesis: "AI agents accelerate enterprise engineering teams",
      category: "AI_TREND",
      sourceCredibility: 0.8,
      evidencePublishedAt: new Date("2026-06-17T12:00:00.000Z"),
      evidenceObservedAt: new Date("2026-06-18T01:30:00.000Z")
    });

    const messages = requests[0].body.messages as Array<{ role: string; content: string }>;
    const prompt = JSON.parse(messages.find((message) => message.role === "user")?.content ?? "{}");
    expect(prompt).toMatchObject({
      evidencePublishedAt: "2026-06-17T12:00:00.000Z",
      evidenceObservedAt: "2026-06-18T01:30:00.000Z"
    });
  });

  it("instructs the LLM scorer to keep partial or missing-constraint evidence neutral", async () => {
    const requests: Array<{ body: Record<string, unknown> }> = [];
    const fakeFetch: typeof fetch = async (_url, init) => {
      requests.push({ body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          model: "deepseek-chat",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  direction: "NEUTRAL",
                  relevance: 0.4,
                  likelihoodRatio: 1,
                  confidence: 0.62,
                  reviewRequired: true,
                  rationale: "The evidence supports only part of the hypothesis."
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

    await llm.estimate({
      evidenceText: "The song peaked at number two on the Billboard Hot 100.",
      hypothesis: "Beautiful reached number two on the Billboard Hot 100 in 2003.",
      category: "TECH_TREND",
      sourceCredibility: 0.8
    });

    const messages = requests[0].body.messages as Array<{ role: string; content: string }>;
    const prompt = JSON.parse(messages.find((message) => message.role === "user")?.content ?? "{}");
    expect(prompt.scoringGuidance).toEqual(
      expect.arrayContaining([
        expect.stringContaining("full hypothesis"),
        expect.stringContaining("Do not use outside knowledge"),
        expect.stringContaining("date"),
        expect.stringContaining("born"),
        expect.stringContaining("named"),
        expect.stringContaining("named item"),
        expect.stringContaining("NEUTRAL"),
        expect.stringContaining("reviewRequired")
      ])
    );
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

  it("normalizes mixed-case LLM direction values before scoring", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          model: "deepseek-chat",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  direction: "opposes",
                  relevance: 0.8,
                  likelihoodRatio: 4,
                  confidence: 0.74,
                  rationale: "The evidence weakens the hypothesis."
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const llm = createLlmEstimator({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-chat",
      fetch: fakeFetch
    });

    await expect(
      llm.estimate({
        evidenceText: "Enterprise rollout slowed after governance reviews.",
        hypothesis: "AI agents accelerate enterprise engineering teams",
        category: "AI_TREND",
        sourceCredibility: 0.8
      })
    ).resolves.toMatchObject({
      estimator: "llm",
      direction: "OPPOSES",
      likelihoodRatio: 0.25,
      confidence: 0.74,
      abstain: false
    });
  });

  it("marks direction and likelihood-ratio contradictions as requiring review", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          model: "deepseek-chat",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  direction: "SUPPORTS",
                  relevance: 0.88,
                  likelihoodRatio: 0.4,
                  confidence: 0.81,
                  reviewRequired: false,
                  rationale: "The evidence supports the hypothesis, but the numeric likelihood ratio contradicts that direction."
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const llm = createLlmEstimator({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-chat",
      fetch: fakeFetch
    });

    await expect(
      llm.estimate({
        evidenceText: "Enterprise adoption increased after agents shipped.",
        hypothesis: "AI agents accelerate enterprise engineering teams",
        category: "AI_TREND",
        sourceCredibility: 0.8
      })
    ).resolves.toMatchObject({
      estimator: "llm",
      direction: "SUPPORTS",
      likelihoodRatio: 2.5,
      reviewRequired: true,
      abstain: false
    });
  });

  it("accepts common LLM JSON field aliases before abstaining", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          model: "deepseek-chat",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  direction: "supports",
                  relevance: 0.82,
                  likelihood_ratio: 3.2,
                  confidence: 0.79,
                  reason: "The evidence supports the hypothesis despite using field aliases."
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const llm = createLlmEstimator({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-chat",
      fetch: fakeFetch
    });

    await expect(
      llm.estimate({
        evidenceText: "Enterprise adoption increased after agents shipped.",
        hypothesis: "AI agents accelerate enterprise engineering teams",
        category: "AI_TREND",
        sourceCredibility: 0.8
      })
    ).resolves.toMatchObject({
      estimator: "llm",
      direction: "SUPPORTS",
      likelihoodRatio: 3.2,
      confidence: 0.79,
      rationale: "The evidence supports the hypothesis despite using field aliases.",
      abstain: false
    });
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

  it("abstains external deep-model scoring without endpoint or model", async () => {
    const estimator = createExternalModelEstimator({ endpoint: "https://models.example/v1" });

    await expect(
      estimator.estimate({
        evidenceText: "Evidence",
        hypothesis: "Hypothesis",
        category: "TECH_TREND",
        sourceCredibility: 0.5
      })
    ).resolves.toMatchObject({
      estimator: "external-deep-model",
      weight: 2,
      abstain: true,
      rationale: "External model endpoint or model is not configured."
    });
  });

  it("does not leak external deep-model API keys in HTTP failure rationales", async () => {
    const estimator = createExternalModelEstimator({
      endpoint: "https://models.example/v1",
      apiKey: "secret-external-key",
      model: "deep-eval-v1",
      fetch: async () => new Response("forbidden secret-external-key", { status: 403 })
    });

    const output = await estimator.estimate({
      evidenceText: "Evidence",
      hypothesis: "Hypothesis",
      category: "TECH_TREND",
      sourceCredibility: 0.5
    });

    expect(output.abstain).toBe(true);
    expect(output.rationale).toBe("External model request failed with status 403.");
    expect(output.rationale).not.toContain("secret-external-key");
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
