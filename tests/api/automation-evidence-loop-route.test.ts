import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorldModelServices: vi.fn(),
  loadLlmEvaluationArtifact: vi.fn()
}));

vi.mock("@/server/services", () => ({
  getWorldModelServices: mocks.getWorldModelServices
}));

vi.mock("@/server/training/llm-evaluation-artifact", () => ({
  loadLlmEvaluationArtifact: mocks.loadLlmEvaluationArtifact
}));

function llmEvaluationArtifact(overrides: Partial<{
  generatedAt: Date | null;
  reviewRequiredRate: number;
  fallbackDivergenceRate: number | null;
  sourceCounts: Record<string, number>;
}> = {}) {
  return {
    ...(overrides.generatedAt === null
      ? {}
      : { generatedAt: overrides.generatedAt ?? new Date() }),
    samplesPath: "model-artifacts/training-samples.jsonl",
    summary: {
      modelName: "deepseek:deepseek-v4-flash",
      sampleCount: 50,
      scoredCount: 50,
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
      sourceCounts: overrides.sourceCounts ?? { fever: 48, github: 1, local_confirmed: 1 },
      fallbackComparedCount: 50,
      fallbackDivergenceCount: overrides.fallbackDivergenceRate === null ? 0 : 4,
      fallbackDivergenceRate: overrides.fallbackDivergenceRate === undefined ? 0.08 : overrides.fallbackDivergenceRate
    }
  };
}

function effectiveBeliefs() {
  return [
    {
      id: "belief_signal",
      code: "B-001",
      title: "AI agents",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      origin: "INTERNAL",
      status: "ACTIVE",
      priorProbability: 0.5,
      currentProbability: 0.5,
      createdAt: new Date("2026-06-18T01:00:00.000Z"),
      updatedAt: new Date("2026-06-18T01:00:00.000Z"),
      hypotheses: [
        {
          id: "hypothesis_signal",
          code: "H-001",
          beliefId: "belief_signal",
          proposition: "AI agents adoption accelerates",
          stance: "SUPPORTS",
          priorProbability: 0.5,
          currentProbability: 0.5,
          status: "ACTIVE",
          startsAt: undefined,
          expiresAt: undefined,
          expiryCondition: "",
          notes: "",
          createdAt: new Date("2026-06-18T01:00:00.000Z"),
          updatedAt: new Date("2026-06-18T01:00:00.000Z")
        },
        {
          id: "hypothesis_counter",
          code: "H-002",
          beliefId: "belief_signal",
          proposition: "AI agents adoption remains constrained",
          stance: "OPPOSES",
          priorProbability: 0.5,
          currentProbability: 0.5,
          status: "ACTIVE",
          startsAt: undefined,
          expiresAt: undefined,
          expiryCondition: "",
          notes: "",
          createdAt: new Date("2026-06-18T01:00:00.000Z"),
          updatedAt: new Date("2026-06-18T01:00:00.000Z")
        }
      ]
    }
  ];
}

function oneSidedBeliefs() {
  return [
    {
      id: "belief_signal",
      code: "B-001",
      title: "AI agents",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      origin: "INTERNAL",
      status: "ACTIVE",
      priorProbability: 0.5,
      currentProbability: 0.5,
      createdAt: new Date("2026-06-18T01:00:00.000Z"),
      updatedAt: new Date("2026-06-18T01:00:00.000Z"),
      hypotheses: [
        {
          id: "hypothesis_signal",
          code: "H-001",
          beliefId: "belief_signal",
          proposition: "AI agents adoption accelerates",
          stance: "SUPPORTS",
          priorProbability: 0.5,
          currentProbability: 0.5,
          status: "ACTIVE",
          startsAt: undefined,
          expiresAt: undefined,
          expiryCondition: "",
          notes: "",
          createdAt: new Date("2026-06-18T01:00:00.000Z"),
          updatedAt: new Date("2026-06-18T01:00:00.000Z")
        }
      ]
    }
  ];
}

describe("automation evidence loop route", () => {
  beforeEach(() => {
    mocks.getWorldModelServices.mockReset();
    mocks.loadLlmEvaluationArtifact.mockReset();
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact());
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
  });

  it("runs the automated evidence loop with caller-provided options", async () => {
    const result = {
      mode: "auto-apply",
      queryCount: 2,
      sourceRunCount: 1,
      skippedSourceCount: 0,
      skippedSources: [],
      itemCount: 3,
      reprocessedObservationCount: 1,
      deduplicatedCount: 0,
      candidateCount: 2,
      autoAppliedCount: 1,
      reviewCount: 1,
      lowImpactCount: 0,
      unmatchedCount: 0,
      failureCount: 0,
      queries: [{ beliefId: "belief_signal", hypothesisId: "hypothesis_signal", category: "AI_TREND", query: "signal evidence" }],
      runs: []
    };
    const runEvidenceLoop = vi.fn().mockResolvedValue(result);
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs: vi.fn().mockResolvedValue(effectiveBeliefs())
      },
      automation: {
        runEvidenceLoop
      }
    });
    const { POST } = await import("@/app/api/automation/evidence-loop/route");
    const body = {
      reviewOnly: false,
      beliefIds: ["belief_signal"],
      sourceIds: ["source_news"],
      candidateThreshold: 0.25,
      autoConfirmThreshold: 0.8,
      maxObservations: 5,
      bootstrapDefaultSources: true,
      forceAutoApply: true
    };

    const response = await POST(
      new Request("http://localhost/api/automation/evidence-loop", {
        method: "POST",
        body: JSON.stringify(body)
      })
    );

    await expect(response.json()).resolves.toEqual(result);
    expect(response.status).toBe(201);
    expect(runEvidenceLoop).toHaveBeenCalledWith(body);
  });

  it("downgrades requested auto-apply loop runs when LLM evaluation quality is risky", async () => {
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact({ reviewRequiredRate: 0.46 }));
    const result = {
      mode: "review-only",
      queryCount: 2,
      sourceRunCount: 1,
      skippedSourceCount: 0,
      skippedSources: [],
      itemCount: 3,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 2,
      autoAppliedCount: 0,
      reviewCount: 2,
      lowImpactCount: 0,
      unmatchedCount: 0,
      failureCount: 0,
      queries: [],
      runs: []
    };
    const runEvidenceLoop = vi.fn().mockResolvedValue(result);
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs: vi.fn().mockResolvedValue(effectiveBeliefs())
      },
      automation: {
        runEvidenceLoop
      }
    });
    const { POST } = await import("@/app/api/automation/evidence-loop/route");

    const response = await POST(
      new Request("http://localhost/api/automation/evidence-loop", {
        method: "POST",
        body: JSON.stringify({
          reviewOnly: false,
          maxObservations: 5,
          bootstrapDefaultSources: true,
          forceAutoApply: true
        })
      })
    );

    await expect(response.json()).resolves.toEqual({
      ...result,
      notice: "LLM 评估风险：LLM 评估复核率偏高，已切换为待审模式。"
    });
    expect(response.status).toBe(201);
    expect(runEvidenceLoop).toHaveBeenCalledWith({
      reviewOnly: true,
      maxObservations: 5,
      bootstrapDefaultSources: true,
      forceAutoApply: false
    });
  });

  it("downgrades auto-apply loop runs when LLM fallback divergence is risky", async () => {
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact({ fallbackDivergenceRate: 0.46 }));
    const result = {
      mode: "review-only",
      queryCount: 2,
      sourceRunCount: 1,
      skippedSourceCount: 0,
      skippedSources: [],
      itemCount: 3,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 2,
      autoAppliedCount: 0,
      reviewCount: 2,
      lowImpactCount: 0,
      unmatchedCount: 0,
      failureCount: 0,
      queries: [],
      runs: []
    };
    const runEvidenceLoop = vi.fn().mockResolvedValue(result);
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs: vi.fn().mockResolvedValue(effectiveBeliefs())
      },
      automation: {
        runEvidenceLoop
      }
    });
    const { POST } = await import("@/app/api/automation/evidence-loop/route");
    const body = {
      reviewOnly: false,
      beliefIds: ["belief_signal"],
      candidateThreshold: 0.25,
      autoConfirmThreshold: 0.8,
      maxObservations: 5,
      forceAutoApply: true
    };

    const response = await POST(
      new Request("http://localhost/api/automation/evidence-loop", {
        method: "POST",
        body: JSON.stringify(body)
      })
    );

    await expect(response.json()).resolves.toEqual({
      ...result,
      notice: "LLM 评估风险：LLM 与 fallback 分歧偏高，已切换为待审模式。"
    });
    expect(response.status).toBe(201);
    expect(runEvidenceLoop).toHaveBeenCalledWith({
      ...body,
      reviewOnly: true,
      forceAutoApply: false
    });
  });

  it("downgrades requested auto-apply loop runs when the LLM evaluation generated time is missing", async () => {
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact({ generatedAt: null }));
    const result = {
      mode: "review-only",
      queryCount: 2,
      sourceRunCount: 1,
      skippedSourceCount: 0,
      skippedSources: [],
      itemCount: 3,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 2,
      autoAppliedCount: 0,
      reviewCount: 2,
      lowImpactCount: 0,
      unmatchedCount: 0,
      failureCount: 0,
      queries: [],
      runs: []
    };
    const runEvidenceLoop = vi.fn().mockResolvedValue(result);
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs: vi.fn().mockResolvedValue(effectiveBeliefs())
      },
      automation: {
        runEvidenceLoop
      }
    });
    const { POST } = await import("@/app/api/automation/evidence-loop/route");
    const body = {
      reviewOnly: false,
      beliefIds: ["belief_signal"],
      maxObservations: 5,
      bootstrapDefaultSources: true,
      forceAutoApply: true
    };

    const response = await POST(
      new Request("http://localhost/api/automation/evidence-loop", {
        method: "POST",
        body: JSON.stringify(body)
      })
    );

    await expect(response.json()).resolves.toEqual({
      ...result,
      notice: "LLM 评估风险：LLM 评估时间缺失，已切换为待审模式。"
    });
    expect(response.status).toBe(201);
    expect(runEvidenceLoop).toHaveBeenCalledWith({
      ...body,
      reviewOnly: true,
      forceAutoApply: false
    });
  });

  it("downgrades requested auto-apply loop runs when the LLM evaluation artifact cannot be loaded", async () => {
    mocks.loadLlmEvaluationArtifact.mockRejectedValue(new Error("artifact read failed"));
    const result = {
      mode: "review-only",
      queryCount: 2,
      sourceRunCount: 1,
      skippedSourceCount: 0,
      skippedSources: [],
      itemCount: 3,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 2,
      autoAppliedCount: 0,
      reviewCount: 2,
      lowImpactCount: 0,
      unmatchedCount: 0,
      failureCount: 0,
      queries: [],
      runs: []
    };
    const runEvidenceLoop = vi.fn().mockResolvedValue(result);
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs: vi.fn().mockResolvedValue(effectiveBeliefs())
      },
      automation: {
        runEvidenceLoop
      }
    });
    const { POST } = await import("@/app/api/automation/evidence-loop/route");
    const body = {
      reviewOnly: false,
      beliefIds: ["belief_signal"],
      maxObservations: 5,
      bootstrapDefaultSources: true,
      forceAutoApply: true
    };

    const response = await POST(
      new Request("http://localhost/api/automation/evidence-loop", {
        method: "POST",
        body: JSON.stringify(body)
      })
    );

    await expect(response.json()).resolves.toEqual({
      ...result,
      notice: "LLM 评估风险：LLM 评估加载失败，已切换为待审模式。"
    });
    expect(response.status).toBe(201);
    expect(runEvidenceLoop).toHaveBeenCalledWith({
      ...body,
      reviewOnly: true,
      forceAutoApply: false
    });
  });

  it("downgrades requested auto-apply loop runs when no hypothesis is currently effective", async () => {
    const result = {
      mode: "review-only",
      queryCount: 0,
      sourceRunCount: 0,
      skippedSourceCount: 0,
      skippedSources: [],
      itemCount: 0,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 0,
      autoAppliedCount: 0,
      reviewCount: 0,
      lowImpactCount: 0,
      unmatchedCount: 0,
      failureCount: 0,
      queries: [],
      runs: []
    };
    const runEvidenceLoop = vi.fn().mockResolvedValue(result);
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs: vi.fn().mockResolvedValue([
          {
            id: "belief_ai_agents",
            code: "B-001",
            title: "AI agents",
            category: "AI_TREND",
            description: "",
            probabilityMode: "INDEPENDENT",
            origin: "INTERNAL",
            status: "ACTIVE",
            priorProbability: 0.5,
            currentProbability: 0.5,
            createdAt: new Date("2026-06-18T01:00:00.000Z"),
            updatedAt: new Date("2026-06-18T01:00:00.000Z"),
            hypotheses: [
              {
                id: "hypothesis_future",
                code: "H-001",
                beliefId: "belief_ai_agents",
                proposition: "AI agents adoption accelerates next month",
                stance: "SUPPORTS",
                priorProbability: 0.5,
                currentProbability: 0.5,
                status: "ACTIVE",
                startsAt: new Date("2099-01-01T00:00:00.000Z"),
                expiresAt: undefined,
                expiryCondition: "",
                notes: "",
                createdAt: new Date("2026-06-18T01:00:00.000Z"),
                updatedAt: new Date("2026-06-18T01:00:00.000Z")
              }
            ]
          }
        ])
      },
      automation: {
        runEvidenceLoop
      }
    });
    const { POST } = await import("@/app/api/automation/evidence-loop/route");

    const response = await POST(
      new Request("http://localhost/api/automation/evidence-loop", {
        method: "POST",
        body: JSON.stringify({
          reviewOnly: false,
          beliefIds: ["belief_ai_agents"],
          maxObservations: 5,
          bootstrapDefaultSources: true,
          forceAutoApply: true
        })
      })
    );

    await expect(response.json()).resolves.toEqual({
      ...result,
      notice: "没有当前有效假设，已切换为待审模式。"
    });
    expect(response.status).toBe(201);
    expect(runEvidenceLoop).toHaveBeenCalledWith({
      reviewOnly: true,
      beliefIds: ["belief_ai_agents"],
      maxObservations: 5,
      bootstrapDefaultSources: true,
      forceAutoApply: false
    });
  });

  it("downgrades requested auto-apply loop runs when hypothesis coverage is one-sided", async () => {
    const result = {
      mode: "review-only",
      queryCount: 1,
      sourceRunCount: 1,
      skippedSourceCount: 0,
      skippedSources: [],
      itemCount: 1,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 1,
      autoAppliedCount: 0,
      reviewCount: 1,
      lowImpactCount: 0,
      unmatchedCount: 0,
      failureCount: 0,
      queries: [],
      runs: []
    };
    const runEvidenceLoop = vi.fn().mockResolvedValue(result);
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs: vi.fn().mockResolvedValue(oneSidedBeliefs())
      },
      automation: {
        runEvidenceLoop
      }
    });
    const { POST } = await import("@/app/api/automation/evidence-loop/route");

    const response = await POST(
      new Request("http://localhost/api/automation/evidence-loop", {
        method: "POST",
        body: JSON.stringify({
          reviewOnly: false,
          beliefIds: ["belief_signal"],
          maxObservations: 5,
          bootstrapDefaultSources: true,
          forceAutoApply: true
        })
      })
    );

    await expect(response.json()).resolves.toEqual({
      ...result,
      notice: "假设覆盖单向，已切换为待审模式。"
    });
    expect(response.status).toBe(201);
    expect(runEvidenceLoop).toHaveBeenCalledWith({
      reviewOnly: true,
      beliefIds: ["belief_signal"],
      maxObservations: 5,
      bootstrapDefaultSources: true,
      forceAutoApply: false
    });
  });

  it("downgrades scoped auto-apply loop runs when the requested belief has no currently effective hypothesis", async () => {
    const result = {
      mode: "review-only",
      queryCount: 0,
      sourceRunCount: 0,
      skippedSourceCount: 0,
      skippedSources: [],
      itemCount: 0,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 0,
      autoAppliedCount: 0,
      reviewCount: 0,
      lowImpactCount: 0,
      unmatchedCount: 0,
      failureCount: 0,
      queries: [],
      runs: []
    };
    const runEvidenceLoop = vi.fn().mockResolvedValue(result);
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs: vi.fn().mockResolvedValue([
          {
            id: "belief_scoped",
            code: "B-001",
            title: "Scoped belief",
            category: "AI_TREND",
            description: "",
            probabilityMode: "INDEPENDENT",
            origin: "INTERNAL",
            status: "ACTIVE",
            priorProbability: 0.5,
            currentProbability: 0.5,
            createdAt: new Date("2026-06-18T01:00:00.000Z"),
            updatedAt: new Date("2026-06-18T01:00:00.000Z"),
            hypotheses: [
              {
                id: "hypothesis_scoped_future",
                code: "H-001",
                beliefId: "belief_scoped",
                proposition: "Scoped hypothesis starts later",
                stance: "SUPPORTS",
                priorProbability: 0.5,
                currentProbability: 0.5,
                status: "ACTIVE",
                startsAt: new Date("2099-01-01T00:00:00.000Z"),
                expiresAt: undefined,
                expiryCondition: "",
                notes: "",
                createdAt: new Date("2026-06-18T01:00:00.000Z"),
                updatedAt: new Date("2026-06-18T01:00:00.000Z")
              }
            ]
          },
          ...effectiveBeliefs()
        ])
      },
      automation: {
        runEvidenceLoop
      }
    });
    const { POST } = await import("@/app/api/automation/evidence-loop/route");

    const response = await POST(
      new Request("http://localhost/api/automation/evidence-loop", {
        method: "POST",
        body: JSON.stringify({
          reviewOnly: false,
          beliefIds: ["belief_scoped"],
          maxObservations: 5,
          bootstrapDefaultSources: true,
          forceAutoApply: true
        })
      })
    );

    await expect(response.json()).resolves.toEqual({
      ...result,
      notice: "没有当前有效假设，已切换为待审模式。"
    });
    expect(response.status).toBe(201);
    expect(runEvidenceLoop).toHaveBeenCalledWith({
      reviewOnly: true,
      beliefIds: ["belief_scoped"],
      maxObservations: 5,
      bootstrapDefaultSources: true,
      forceAutoApply: false
    });
  });
});
