import { createInMemoryWorldModelStore } from "@/server/services/in-memory-store";
import { createConfiguredWorldModelServices } from "@/server/services/configured";
import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadLlmEvaluationArtifact: vi.fn()
}));

vi.mock("@/server/training/llm-evaluation-artifact", () => ({
  loadLlmEvaluationArtifact: mocks.loadLlmEvaluationArtifact
}));

function llmEvaluationArtifact(overrides: Partial<{
  reviewRequiredRate: number;
  fallbackDivergenceRate: number | null;
}> = {}) {
  return {
    generatedAt: new Date("2026-06-18T01:00:00.000Z"),
    samplesPath: "model-artifacts/training-samples.jsonl",
    summary: {
      modelName: "deepseek:deepseek-v4-flash",
      sampleCount: 50,
      scoredCount: 50,
      sourceCounts: { fever: 49, local_confirmed: 1 },
      directionAccuracy: {
        SUPPORTS: { total: 20, scored: 20, correct: 18, accuracy: 0.9 },
        OPPOSES: { total: 15, scored: 15, correct: 13, accuracy: 0.87 },
        NEUTRAL: { total: 15, scored: 15, correct: 13, accuracy: 0.87 }
      },
      likelihoodRatio: { min: 0.4, max: 10, mean: 2.4 },
      lowConfidenceCount: 2,
      lowConfidenceRate: 0.04,
      reviewRequiredCount: 4,
      reviewRequiredRate: overrides.reviewRequiredRate ?? 0.08,
      fallbackComparedCount: 50,
      fallbackDivergenceCount: overrides.fallbackDivergenceRate === null ? 0 : 4,
      fallbackDivergenceRate: overrides.fallbackDivergenceRate === undefined ? 0.08 : overrides.fallbackDivergenceRate
    }
  };
}

function balancedAgentHypotheses() {
  return [
    {
      proposition: "AI agents accelerate engineering teams",
      priorProbability: 0.35,
      stance: "SUPPORTS" as const,
      notes: ""
    },
    {
      proposition: "AI agents fail to accelerate engineering teams",
      priorProbability: 0.35,
      stance: "OPPOSES" as const,
      notes: ""
    }
  ];
}

describe("configured world model services", () => {
  beforeEach(() => {
    mocks.loadLlmEvaluationArtifact.mockReset();
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact());
  });

  it("uses the configured LLM estimator in the automated evidence loop", async () => {
    const services = createConfiguredWorldModelServices(createInMemoryWorldModelStore(), {
      env: {
        LLM_PROVIDER: "deepseek",
        LLM_BASE_URL: "https://llm.example",
        LLM_API_KEY: "test-key",
        LLM_MODEL: "test-model"
      },
      async llmFetch() {
        return new Response(
          JSON.stringify({
            model: "test-model",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    direction: "OPPOSES",
                    relevance: 0.9,
                    likelihoodRatio: 0.5,
                    confidence: 0.8,
                    rationale: "LLM configured estimator result"
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      sourceAdapterDependencies: {
        async fetchText(url) {
          const query = new URL(url).searchParams.get("q") ?? "";
          return `<html><head><title>${query}</title></head><body>${query}</body></html>`;
        }
      },
      autoApplyPolicy: async (input) => input
    });

    const belief = await services.beliefs.createBelief({
      title: "LLM configured automation",
      category: "AI_TREND",
      description: "Checks configured estimator wiring.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "LLM configured automation should use model output",
          priorProbability: 0.5,
          notes: "model output"
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Configured search source",
      kind: "SEARCH",
      url: "https://example.test/search?q={query}",
      adapter: "search",
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    await services.automation.runEvidenceLoop({ beliefIds: [belief.id], sourceIds: [source.id], autoConfirmThreshold: 0.2 });
    const [evidence] = await services.evidence.listEvidence();
    const updated = await services.beliefs.getBelief(belief.id);

    expect(evidence.links[0]).toMatchObject({
      direction: "OPPOSES",
      likelihoodRatio: 0.5,
      confidence: 0.8,
      rationale: "LLM configured estimator result"
    });
    expect(updated?.hypotheses[0].currentProbability).toBeLessThan(0.5);
  });

  it("uses configured LLM hypothesis recommendations by default when credentials are configured", async () => {
    const defaultCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const defaultServices = createConfiguredWorldModelServices(createInMemoryWorldModelStore(), {
      env: {
        LLM_PROVIDER: "deepseek",
        LLM_API_KEY: "test-key"
      },
      async llmFetch(input, init) {
        defaultCalls.push({
          url: String(input),
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        });
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    recommendations: [
                      {
                        proposition: "Procurement slips when security owners require model risk review",
                        stance: "OPPOSES",
                        priorProbability: 0.41,
                        notes: "可观察：安全负责人追加模型风险评估、供应商问卷或法务审查。",
                        evidenceSearchQuery: "enterprise AI procurement security owner model risk review delay",
                        rationale: "校准失败显示安全审查触发条件被低估。"
                      }
                    ]
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });
    const defaultBelief = await defaultServices.beliefs.createBelief({
      title: "AI procurement timing",
      category: "AI_TREND",
      description: "Track whether enterprise procurement timelines are realistic.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Enterprise AI procurement finishes this quarter",
          priorProbability: 0.58,
          stance: "SUPPORTS",
          notes: "pipeline timing"
        }
      ]
    });
    await defaultServices.beliefs.updateHypothesis(defaultBelief.hypotheses[0].id, {
      status: "RESOLVED_FALSE",
      currentProbability: 0.86,
      resolvedOutcome: "The procurement decision slipped into the next quarter."
    });

    const defaultRecommendations = await defaultServices.beliefs.recommendHypotheses(defaultBelief.id, { limit: 4 });

    expect(defaultCalls).toHaveLength(1);
    expect(defaultCalls[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(defaultCalls[0].body).toMatchObject({
      response_format: { type: "json_object" }
    });
    expect(defaultRecommendations[0]).toMatchObject({
      proposition: "Procurement slips when security owners require model risk review",
      calibrationHypothesisId: defaultBelief.hypotheses[0].id,
      calibrationError: 0.86
    });

    const disabledCalls: string[] = [];
    const disabledServices = createConfiguredWorldModelServices(createInMemoryWorldModelStore(), {
      env: {
        LLM_API_KEY: "test-key",
        LLM_HYPOTHESIS_RECOMMENDATIONS: "false"
      },
      async llmFetch(input) {
        disabledCalls.push(String(input));
        return new Response(JSON.stringify({ choices: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    const disabledBelief = await disabledServices.beliefs.createBelief({
      title: "AI procurement timing",
      category: "AI_TREND",
      description: "Track whether enterprise procurement timelines are realistic.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Enterprise AI procurement finishes this quarter",
          priorProbability: 0.58,
          stance: "SUPPORTS",
          notes: "pipeline timing"
        }
      ]
    });
    await disabledServices.beliefs.updateHypothesis(disabledBelief.hypotheses[0].id, {
      status: "RESOLVED_FALSE",
      currentProbability: 0.86,
      resolvedOutcome: "The procurement decision slipped into the next quarter."
    });

    const disabledRecommendations = await disabledServices.beliefs.recommendHypotheses(disabledBelief.id, { limit: 4 });

    expect(disabledCalls).toHaveLength(0);
    expect(disabledRecommendations[0].proposition).toBe("导致「Enterprise AI procurement finishes this quarter」被证伪的条件仍可能复现");
  });

  it("uses the default LLM evaluation policy to downgrade risky source auto-confirm", async () => {
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact({ reviewRequiredRate: 0.46 }));
    const services = createConfiguredWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        async fetchText() {
          return "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams by handling routine implementation work.</body></html>";
        }
      }
    });

    await services.beliefs.createBelief({
      title: "AI agents",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: balancedAgentHypotheses()
    });
    const source = await services.sources.createSource({
      name: "Configured auto-confirm source",
      kind: "WEB_PAGE",
      url: "https://example.test/agent-signal",
      adapter: "web_page",
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    const run = await services.sources.runSource(source.id);
    const evidence = await services.evidence.listEvidence();

    expect(run.status).toBe("REVIEW_ONLY");
    expect(run.autoAppliedCount).toBe(0);
    expect(run.reviewCount).toBe(1);
    expect(evidence).toHaveLength(0);
  });

  it("uses the default coverage policy to downgrade one-sided source auto-confirm", async () => {
    const services = createConfiguredWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        async fetchText() {
          return "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams by handling routine implementation work.</body></html>";
        }
      }
    });

    await services.beliefs.createBelief({
      title: "AI agents",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "AI agents accelerate engineering teams",
          priorProbability: 0.35,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Configured auto-confirm source",
      kind: "WEB_PAGE",
      url: "https://example.test/agent-signal",
      adapter: "web_page",
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    const run = await services.sources.runSource(source.id);
    const observations = await services.observations.listObservations();
    const evidence = await services.evidence.listEvidence();

    expect(run.status).toBe("REVIEW_ONLY");
    expect(run.autoAppliedCount).toBe(0);
    expect(run.reviewCount).toBe(1);
    expect(observations[0]?.metadata.reviewReason).toBe("ONE_SIDED_HYPOTHESIS_COVERAGE");
    expect(evidence).toHaveLength(0);
  });

  it("downgrades configured source auto-confirm when that source has material rejected evidence history", async () => {
    const services = createConfiguredWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        async fetchText() {
          return "<html><head><title>Fresh AI agents accelerate engineering teams</title></head><body>Fresh AI agents accelerate engineering teams signal.</body></html>";
        }
      }
    });

    const belief = await services.beliefs.createBelief({
      title: "AI agents",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: balancedAgentHypotheses()
    });
    const source = await services.sources.createSource({
      name: "Risky configured auto-confirm source",
      kind: "WEB_PAGE",
      url: "https://example.test/fresh-agent-signal",
      adapter: "web_page",
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    for (const title of ["Rejected prior signal A", "Rejected prior signal B"]) {
      const observation = await services.observations.createObservation({
        sourceId: source.id,
        title,
        content: `${title} says AI agents accelerate engineering teams.`,
        credibility: 0.8
      });
      const result = await services.evidence.confirmAndApplyObservation({
        observationId: observation.id,
        confirmationMode: "AUTO",
        links: [
          {
            hypothesisId: belief.hypotheses[0].id,
            direction: "SUPPORTS",
            relevance: 0.9,
            likelihoodRatio: 2.2,
            confidence: 0.8,
            rationale: "Prior source signal looked strong before review."
          }
        ]
      });
      await services.evidence.reject(result.evidence.id);
    }

    const run = await services.sources.runSource(source.id);
    const observations = await services.observations.listObservations();
    const evidence = await services.evidence.listEvidence();
    const updates = await services.updates.listEvents();

    expect(run.status).toBe("REVIEW_ONLY");
    expect(run.autoAppliedCount).toBe(0);
    expect(run.reviewCount).toBe(1);
    expect(evidence.filter((item) => item.status === "ACTIVE")).toHaveLength(0);
    expect(updates.filter((item) => item.status === "ROLLED_BACK")).toHaveLength(2);
    expect(observations.at(-1)?.metadata.reviewReason).toBe("SOURCE_EVIDENCE_QUALITY_RISK");
  });

  it("keeps the one-sided coverage reason when a caller already requested review-only", async () => {
    const services = createConfiguredWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        async fetchText() {
          return "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams by handling routine implementation work.</body></html>";
        }
      }
    });

    await services.beliefs.createBelief({
      title: "AI agents",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "AI agents accelerate engineering teams",
          priorProbability: 0.35,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Configured auto-confirm source",
      kind: "WEB_PAGE",
      url: "https://example.test/agent-signal",
      adapter: "web_page",
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    const run = await services.sources.runSource(source.id, { reviewOnly: true });
    const observations = await services.observations.listObservations();

    expect(run.status).toBe("REVIEW_ONLY");
    expect(run.autoAppliedCount).toBe(0);
    expect(run.reviewCount).toBe(1);
    expect(observations[0]?.metadata.reviewReason).toBe("ONE_SIDED_HYPOTHESIS_COVERAGE");
  });

  it("keeps configured source auto-confirm enabled when effective coverage is balanced", async () => {
    const services = createConfiguredWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        async fetchText() {
          return "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams by handling routine implementation work.</body></html>";
        }
      }
    });

    await services.beliefs.createBelief({
      title: "AI agents",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: balancedAgentHypotheses()
    });
    const source = await services.sources.createSource({
      name: "Configured auto-confirm source",
      kind: "WEB_PAGE",
      url: "https://example.test/agent-signal",
      adapter: "web_page",
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    const run = await services.sources.runSource(source.id);
    const evidence = await services.evidence.listEvidence();

    expect(run.status).toBe("SUCCESS");
    expect(run.autoAppliedCount).toBe(1);
    expect(run.reviewCount).toBe(0);
    expect(evidence).toHaveLength(1);
  });

  it("reports a downgraded evidence loop as review-only when the default policy blocks auto-confirm", async () => {
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact({ reviewRequiredRate: 0.46 }));
    const services = createConfiguredWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        async fetchText() {
          return "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams by handling routine implementation work.</body></html>";
        }
      }
    });

    const belief = await services.beliefs.createBelief({
      title: "AI agents",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: balancedAgentHypotheses()
    });
    const source = await services.sources.createSource({
      name: "Configured loop source",
      kind: "WEB_PAGE",
      url: "https://example.test/agent-loop",
      adapter: "web_page",
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    const result = await services.automation.runEvidenceLoop({
      beliefIds: [belief.id],
      sourceIds: [source.id],
      autoConfirmThreshold: 0.2
    });

    expect(result.mode).toBe("review-only");
    expect(result.autoAppliedCount).toBe(0);
    expect(result.reviewCount).toBe(1);
    expect(result.runs.map((run) => run.status)).toEqual(["REVIEW_ONLY"]);
  });
});
