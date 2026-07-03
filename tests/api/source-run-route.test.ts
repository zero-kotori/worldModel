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
  reviewRequiredRate: number;
  fallbackDivergenceRate: number | null;
  sourceCounts: Record<string, number>;
}> = {}) {
  return {
    generatedAt: new Date(),
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
      status: "ACTIVE",
      hypotheses: [
        {
          id: "hypothesis_signal",
          status: "ACTIVE",
          stance: "SUPPORTS"
        },
        {
          id: "hypothesis_counter",
          status: "ACTIVE",
          stance: "OPPOSES"
        }
      ]
    }
  ];
}

function oneSidedBeliefs() {
  return [
    {
      id: "belief_signal",
      status: "ACTIVE",
      hypotheses: [
        {
          id: "hypothesis_signal",
          status: "ACTIVE",
          stance: "SUPPORTS"
        }
      ]
    }
  ];
}

describe("source run route", () => {
  beforeEach(() => {
    mocks.getWorldModelServices.mockReset();
    mocks.loadLlmEvaluationArtifact.mockReset();
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact());
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
  });

  it("runs a real source when no dry-run observations are supplied", async () => {
    const run = {
      id: "observation_run_real",
      sourceId: "source_news",
      status: "SUCCESS",
      itemCount: 3,
      candidateCount: 2,
      autoAppliedCount: 1
    };
    const runSource = vi.fn().mockResolvedValue(run);
    const runDryRun = vi.fn().mockResolvedValue({ id: "observation_run_dry", status: "DRY_RUN" });
    const listSources = vi.fn().mockResolvedValue([{ id: "source_news", autoConfirm: false }]);
    const listBeliefs = vi.fn().mockResolvedValue(effectiveBeliefs());
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs
      },
      sources: {
        listSources,
        runSource,
        runDryRun
      }
    });
    const { POST } = await import("@/app/api/sources/[id]/run/route");
    const body = {
      reviewOnly: false,
      forceAutoApply: true,
      candidateThreshold: 0.25,
      autoConfirmThreshold: 0.8,
      maxQueries: 2,
      maxObservations: 10,
      queries: [{ beliefId: "belief_signal", hypothesisId: "hypothesis_signal", category: "AI_TREND", query: "signal evidence" }]
    };

    const response = await POST(
      new Request("http://localhost/api/sources/source_news/run", {
        method: "POST",
        body: JSON.stringify(body)
      }),
      { params: Promise.resolve({ id: "source_news" }) }
    );

    await expect(response.json()).resolves.toEqual(run);
    expect(response.status).toBe(201);
    expect(runSource).toHaveBeenCalledWith("source_news", body);
    expect(runDryRun).not.toHaveBeenCalled();
  });

  it("downgrades requested auto-apply source runs when LLM evaluation quality is risky", async () => {
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact({ reviewRequiredRate: 0.46 }));
    const run = {
      id: "observation_run_review",
      sourceId: "source_news",
      status: "REVIEW_ONLY",
      itemCount: 3,
      candidateCount: 2,
      autoAppliedCount: 0,
      reviewCount: 2
    };
    const runSource = vi.fn().mockResolvedValue(run);
    const runDryRun = vi.fn();
    const listSources = vi.fn().mockResolvedValue([{ id: "source_news", autoConfirm: false }]);
    const listBeliefs = vi.fn().mockResolvedValue(effectiveBeliefs());
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs
      },
      sources: {
        listSources,
        runSource,
        runDryRun
      }
    });
    const { POST } = await import("@/app/api/sources/[id]/run/route");

    const response = await POST(
      new Request("http://localhost/api/sources/source_news/run", {
        method: "POST",
        body: JSON.stringify({
          reviewOnly: false,
          forceAutoApply: true,
          candidateThreshold: 0.25,
          maxObservations: 10
        })
      }),
      { params: Promise.resolve({ id: "source_news" }) }
    );

    await expect(response.json()).resolves.toEqual({
      ...run,
      notice: "LLM 评估风险：LLM 评估复核率偏高，已切换为待审模式。"
    });
    expect(response.status).toBe(201);
    expect(runSource).toHaveBeenCalledWith("source_news", {
      reviewOnly: true,
      forceAutoApply: false,
      candidateThreshold: 0.25,
      autoConfirmThreshold: undefined,
      maxObservations: 10,
      queries: undefined
    });
    expect(runDryRun).not.toHaveBeenCalled();
  });

  it("downgrades forced auto-apply when LLM fallback divergence is risky", async () => {
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact({ fallbackDivergenceRate: 0.46 }));
    const run = {
      id: "observation_run_review",
      sourceId: "source_news",
      status: "REVIEW_ONLY",
      itemCount: 3,
      candidateCount: 2,
      autoAppliedCount: 0,
      reviewCount: 2
    };
    const runSource = vi.fn().mockResolvedValue(run);
    const runDryRun = vi.fn();
    const listSources = vi.fn().mockResolvedValue([{ id: "source_news", autoConfirm: false }]);
    const listBeliefs = vi.fn().mockResolvedValue(effectiveBeliefs());
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs
      },
      sources: {
        listSources,
        runSource,
        runDryRun
      }
    });
    const { POST } = await import("@/app/api/sources/[id]/run/route");

    const response = await POST(
      new Request("http://localhost/api/sources/source_news/run", {
        method: "POST",
        body: JSON.stringify({
          reviewOnly: false,
          forceAutoApply: true,
          candidateThreshold: 0.25,
          maxObservations: 10
        })
      }),
      { params: Promise.resolve({ id: "source_news" }) }
    );

    await expect(response.json()).resolves.toEqual({
      ...run,
      notice: "LLM 评估风险：LLM 与 fallback 分歧偏高，已切换为待审模式。"
    });
    expect(response.status).toBe(201);
    expect(runSource).toHaveBeenCalledWith("source_news", {
      reviewOnly: true,
      forceAutoApply: false,
      candidateThreshold: 0.25,
      autoConfirmThreshold: undefined,
      maxObservations: 10,
      queries: undefined
    });
    expect(runDryRun).not.toHaveBeenCalled();
  });

  it("downgrades source-default auto-confirm runs when LLM evaluation quality is risky", async () => {
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact({ reviewRequiredRate: 0.46 }));
    const run = {
      id: "observation_run_review",
      sourceId: "source_news",
      status: "REVIEW_ONLY",
      itemCount: 3,
      candidateCount: 2,
      autoAppliedCount: 0,
      reviewCount: 2
    };
    const runSource = vi.fn().mockResolvedValue(run);
    const runDryRun = vi.fn();
    const listSources = vi.fn().mockResolvedValue([{ id: "source_news", autoConfirm: true }]);
    const listBeliefs = vi.fn().mockResolvedValue(effectiveBeliefs());
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs
      },
      sources: {
        listSources,
        runSource,
        runDryRun
      }
    });
    const { POST } = await import("@/app/api/sources/[id]/run/route");

    const response = await POST(
      new Request("http://localhost/api/sources/source_news/run", {
        method: "POST",
        body: JSON.stringify({
          candidateThreshold: 0.25,
          maxObservations: 10
        })
      }),
      { params: Promise.resolve({ id: "source_news" }) }
    );

    await expect(response.json()).resolves.toEqual({
      ...run,
      notice: "LLM 评估风险：LLM 评估复核率偏高，已切换为待审模式。"
    });
    expect(response.status).toBe(201);
    expect(runSource).toHaveBeenCalledWith("source_news", {
      reviewOnly: true,
      forceAutoApply: false,
      beliefIds: undefined,
      candidateThreshold: 0.25,
      autoConfirmThreshold: undefined,
      maxQueries: undefined,
      maxObservations: 10,
      queries: undefined
    });
    expect(runDryRun).not.toHaveBeenCalled();
  });

  it("downgrades source-default auto-confirm when LLM fallback divergence is risky", async () => {
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact({ fallbackDivergenceRate: 0.46 }));
    const run = {
      id: "observation_run_review_default",
      sourceId: "source_news",
      status: "REVIEW_ONLY",
      itemCount: 3,
      candidateCount: 2,
      autoAppliedCount: 0,
      reviewCount: 2
    };
    const runSource = vi.fn().mockResolvedValue(run);
    const runDryRun = vi.fn();
    const listSources = vi.fn().mockResolvedValue([{ id: "source_news", autoConfirm: true }]);
    const listBeliefs = vi.fn().mockResolvedValue(effectiveBeliefs());
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs
      },
      sources: {
        listSources,
        runSource,
        runDryRun
      }
    });
    const { POST } = await import("@/app/api/sources/[id]/run/route");

    const response = await POST(
      new Request("http://localhost/api/sources/source_news/run", {
        method: "POST",
        body: JSON.stringify({
          candidateThreshold: 0.25,
          maxObservations: 10
        })
      }),
      { params: Promise.resolve({ id: "source_news" }) }
    );

    await expect(response.json()).resolves.toEqual({
      ...run,
      notice: "LLM 评估风险：LLM 与 fallback 分歧偏高，已切换为待审模式。"
    });
    expect(response.status).toBe(201);
    expect(runSource).toHaveBeenCalledWith("source_news", {
      reviewOnly: true,
      forceAutoApply: false,
      beliefIds: undefined,
      candidateThreshold: 0.25,
      autoConfirmThreshold: undefined,
      maxQueries: undefined,
      maxObservations: 10,
      queries: undefined
    });
    expect(runDryRun).not.toHaveBeenCalled();
  });

  it("downgrades source-default auto-confirm runs when scoped source evidence quality is risky", async () => {
    const run = {
      id: "observation_run_review",
      sourceId: "source_news",
      status: "REVIEW_ONLY",
      itemCount: 1,
      candidateCount: 1,
      autoAppliedCount: 0,
      reviewCount: 1
    };
    const runSource = vi.fn().mockResolvedValue(run);
    const runDryRun = vi.fn();
    const listSources = vi.fn().mockResolvedValue([
      { id: "source_news", name: "News source", kind: "WEB_PAGE", enabled: true, autoConfirm: true },
      { id: "source_other", name: "Other source", kind: "WEB_PAGE", enabled: true, autoConfirm: true }
    ]);
    const listBeliefs = vi.fn().mockResolvedValue(effectiveBeliefs());
    const listObservations = vi.fn().mockResolvedValue([
      { id: "observation_ok", sourceId: "source_news" },
      { id: "observation_rejected", sourceId: "source_news" },
      { id: "observation_rolled", sourceId: "source_news" },
      { id: "observation_other", sourceId: "source_other" }
    ]);
    const listEvidence = vi.fn().mockResolvedValue([
      { id: "evidence_ok", observationId: "observation_ok", status: "ACTIVE" },
      { id: "evidence_rejected", observationId: "observation_rejected", status: "REJECTED" },
      { id: "evidence_rolled", observationId: "observation_rolled", status: "ACTIVE" },
      { id: "evidence_other", observationId: "observation_other", status: "ACTIVE" }
    ]);
    const listEvents = vi.fn().mockResolvedValue([{ id: "update_rolled", evidenceId: "evidence_rolled", status: "ROLLED_BACK" }]);
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs
      },
      observations: {
        listObservations
      },
      evidence: {
        listEvidence
      },
      updates: {
        listEvents
      },
      sources: {
        listSources,
        runSource,
        runDryRun
      }
    });
    const { POST } = await import("@/app/api/sources/[id]/run/route");

    const response = await POST(
      new Request("http://localhost/api/sources/source_news/run", {
        method: "POST",
        body: JSON.stringify({
          candidateThreshold: 0.25,
          maxObservations: 10
        })
      }),
      { params: Promise.resolve({ id: "source_news" }) }
    );

    await expect(response.json()).resolves.toEqual({
      ...run,
      notice: "来源证据质量风险：News source 的证据质量偏低（2/3 条出现拒绝或回滚），已切换为待审模式。"
    });
    expect(response.status).toBe(201);
    expect(runSource).toHaveBeenCalledWith("source_news", {
      reviewOnly: true,
      forceAutoApply: false,
      beliefIds: undefined,
      candidateThreshold: 0.25,
      autoConfirmThreshold: undefined,
      maxQueries: undefined,
      maxObservations: 10,
      queries: undefined
    });
    expect(runDryRun).not.toHaveBeenCalled();
  });

  it("downgrades source-default auto-confirm runs when no scoped hypothesis is currently effective", async () => {
    const run = {
      id: "observation_run_review",
      sourceId: "source_news",
      status: "REVIEW_ONLY",
      itemCount: 3,
      candidateCount: 2,
      autoAppliedCount: 0,
      reviewCount: 2
    };
    const runSource = vi.fn().mockResolvedValue(run);
    const runDryRun = vi.fn();
    const listSources = vi.fn().mockResolvedValue([{ id: "source_news", autoConfirm: true }]);
    const listBeliefs = vi.fn().mockResolvedValue([
      {
        id: "belief_signal",
        status: "ACTIVE",
        hypotheses: [
          {
            id: "hypothesis_signal",
            status: "ACTIVE",
            startsAt: new Date("2026-05-01T00:00:00.000Z"),
            expiresAt: new Date("2026-05-31T00:00:00.000Z")
          }
        ]
      }
    ]);
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs
      },
      sources: {
        listSources,
        runSource,
        runDryRun
      }
    });
    const { POST } = await import("@/app/api/sources/[id]/run/route");

    const response = await POST(
      new Request("http://localhost/api/sources/source_news/run", {
        method: "POST",
        body: JSON.stringify({
          beliefIds: ["belief_signal"],
          candidateThreshold: 0.25,
          maxObservations: 10
        })
      }),
      { params: Promise.resolve({ id: "source_news" }) }
    );

    await expect(response.json()).resolves.toEqual({
      ...run,
      notice: "没有当前有效假设，已切换为待审模式。"
    });
    expect(response.status).toBe(201);
    expect(runSource).toHaveBeenCalledWith("source_news", {
      reviewOnly: true,
      forceAutoApply: false,
      beliefIds: ["belief_signal"],
      candidateThreshold: 0.25,
      autoConfirmThreshold: undefined,
      maxQueries: undefined,
      maxObservations: 10,
      queries: undefined
    });
    expect(runDryRun).not.toHaveBeenCalled();
  });

  it("downgrades source-default auto-confirm runs when hypothesis coverage is one-sided", async () => {
    const run = {
      id: "observation_run_review",
      sourceId: "source_news",
      status: "REVIEW_ONLY",
      itemCount: 3,
      candidateCount: 2,
      autoAppliedCount: 0,
      reviewCount: 2
    };
    const runSource = vi.fn().mockResolvedValue(run);
    const runDryRun = vi.fn();
    const listSources = vi.fn().mockResolvedValue([{ id: "source_news", autoConfirm: true }]);
    const listBeliefs = vi.fn().mockResolvedValue(oneSidedBeliefs());
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs
      },
      sources: {
        listSources,
        runSource,
        runDryRun
      }
    });
    const { POST } = await import("@/app/api/sources/[id]/run/route");

    const response = await POST(
      new Request("http://localhost/api/sources/source_news/run", {
        method: "POST",
        body: JSON.stringify({
          beliefIds: ["belief_signal"],
          candidateThreshold: 0.25,
          maxObservations: 10
        })
      }),
      { params: Promise.resolve({ id: "source_news" }) }
    );

    await expect(response.json()).resolves.toEqual({
      ...run,
      notice: "假设覆盖单向，已切换为待审模式。"
    });
    expect(response.status).toBe(201);
    expect(runSource).toHaveBeenCalledWith("source_news", {
      reviewOnly: true,
      forceAutoApply: false,
      beliefIds: ["belief_signal"],
      candidateThreshold: 0.25,
      autoConfirmThreshold: undefined,
      maxQueries: undefined,
      maxObservations: 10,
      queries: undefined
    });
    expect(runDryRun).not.toHaveBeenCalled();
  });

  it("keeps explicit dry-run observations on the dry-run path", async () => {
    const run = {
      id: "observation_run_dry",
      sourceId: "source_news",
      status: "DRY_RUN",
      itemCount: 1
    };
    const runSource = vi.fn();
    const runDryRun = vi.fn().mockResolvedValue(run);
    const listSources = vi.fn();
    mocks.getWorldModelServices.mockReturnValue({
      sources: {
        listSources,
        runSource,
        runDryRun
      }
    });
    const { POST } = await import("@/app/api/sources/[id]/run/route");
    const observations = [{ title: "Sample", content: "Sample observation content", url: "https://example.com/sample" }];

    const response = await POST(
      new Request("http://localhost/api/sources/source_news/run", {
        method: "POST",
        body: JSON.stringify({ observations })
      }),
      { params: Promise.resolve({ id: "source_news" }) }
    );

    await expect(response.json()).resolves.toEqual(run);
    expect(response.status).toBe(201);
    expect(runDryRun).toHaveBeenCalledWith("source_news", observations);
    expect(runSource).not.toHaveBeenCalled();
  });
});
