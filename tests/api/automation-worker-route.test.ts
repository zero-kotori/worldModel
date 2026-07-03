import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorldModelServices: vi.fn(),
  getEvidenceLoopWorkerController: vi.fn(),
  loadLlmEvaluationArtifact: vi.fn()
}));

vi.mock("@/server/services", () => ({
  getWorldModelServices: mocks.getWorldModelServices
}));

vi.mock("@/server/automation/local-worker", () => ({
  getEvidenceLoopWorkerController: mocks.getEvidenceLoopWorkerController
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
      id: "belief_ai_agents",
      code: "B-001",
      title: "AI agents",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      status: "ACTIVE",
      priorProbability: 0.5,
      currentProbability: 0.5,
      createdAt: new Date("2026-06-18T01:00:00.000Z"),
      updatedAt: new Date("2026-06-18T01:00:00.000Z"),
      hypotheses: [
        {
          id: "hypothesis_signal",
          code: "H-001",
          beliefId: "belief_ai_agents",
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
          beliefId: "belief_ai_agents",
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
      id: "belief_ai_agents",
      code: "B-001",
      title: "AI agents",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      status: "ACTIVE",
      priorProbability: 0.5,
      currentProbability: 0.5,
      createdAt: new Date("2026-06-18T01:00:00.000Z"),
      updatedAt: new Date("2026-06-18T01:00:00.000Z"),
      hypotheses: [
        {
          id: "hypothesis_signal",
          code: "H-001",
          beliefId: "belief_ai_agents",
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

describe("automation worker route", () => {
  beforeEach(() => {
    mocks.getWorldModelServices.mockReset();
    mocks.getEvidenceLoopWorkerController.mockReset();
    mocks.loadLlmEvaluationArtifact.mockReset();
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact());
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
  });

  it("returns persisted worker state and in-process runtime state", async () => {
    const configs = [
      {
        id: "default",
        enabled: true,
        intervalMs: 900_000,
        failureBackoffMultiplier: 2,
        maxIntervalMs: 3_600_000,
        reviewOnly: false,
        maxQueries: 3,
        maxSources: 3,
        beliefIds: ["belief_ai_agents"],
        sourceIds: ["source_github"],
        maxObservations: 20,
        candidateThreshold: 0.25,
        autoConfirmThreshold: 0.8,
        bootstrapDefaultSources: true,
        forceAutoApply: true,
        createdAt: new Date("2026-06-12T00:00:00.000Z"),
        updatedAt: new Date("2026-06-12T00:00:00.000Z")
      }
    ];
    const heartbeats = [
      {
        id: "default",
        status: "RUNNING",
        heartbeatAt: new Date("2026-06-12T00:01:00.000Z"),
        nextRunAt: new Date("2026-06-12T00:16:00.000Z"),
        intervalMs: 900_000,
        consecutiveFailureCount: 0,
        lastError: "",
        createdAt: new Date("2026-06-12T00:01:00.000Z"),
        updatedAt: new Date("2026-06-12T00:01:00.000Z")
      }
    ];
    const runtime = [{ workerId: "default", running: true, nextRunAt: new Date("2026-06-12T00:16:00.000Z"), consecutiveFailureCount: 0 }];
    mocks.getWorldModelServices.mockReturnValue({
      automation: {
        listWorkerConfigs: vi.fn().mockResolvedValue(configs),
        listHeartbeats: vi.fn().mockResolvedValue(heartbeats)
      }
    });
    mocks.getEvidenceLoopWorkerController.mockReturnValue({
      restoreEnabled: vi.fn().mockResolvedValue(runtime),
      listRuntime: vi.fn().mockReturnValue(runtime)
    });
    const { GET } = await import("@/app/api/automation/worker/route");

    const response = await GET(new Request("http://localhost/api/automation/worker", { method: "GET" }));

    await expect(response.json()).resolves.toEqual({
      runtime: JSON.parse(JSON.stringify(runtime)),
      configs: JSON.parse(JSON.stringify(configs)),
      heartbeats: JSON.parse(JSON.stringify(heartbeats))
    });
    expect(response.status).toBe(200);
  });

  it("restores enabled persisted workers before returning runtime status", async () => {
    const configs = [
      {
        id: "default",
        enabled: true,
        intervalMs: 900_000,
        failureBackoffMultiplier: 2,
        maxIntervalMs: 3_600_000,
        reviewOnly: false,
        maxQueries: 3,
        maxSources: 3,
        beliefIds: ["belief_ai_agents"],
        sourceIds: ["source_github"],
        maxObservations: 20,
        candidateThreshold: 0.25,
        autoConfirmThreshold: 0.8,
        bootstrapDefaultSources: true,
        forceAutoApply: true,
        createdAt: new Date("2026-06-12T00:00:00.000Z"),
        updatedAt: new Date("2026-06-12T00:00:00.000Z")
      }
    ];
    const heartbeats = [
      {
        id: "default",
        status: "RUNNING",
        heartbeatAt: new Date("2026-06-12T00:01:00.000Z"),
        nextRunAt: new Date("2026-06-12T00:16:00.000Z"),
        intervalMs: 900_000,
        consecutiveFailureCount: 0,
        lastError: "",
        createdAt: new Date("2026-06-12T00:01:00.000Z"),
        updatedAt: new Date("2026-06-12T00:01:00.000Z")
      }
    ];
    const runtime = [{ workerId: "default", running: true, nextRunAt: new Date("2026-06-12T00:16:00.000Z"), consecutiveFailureCount: 0 }];
    const services = {
      automation: {
        listWorkerConfigs: vi.fn().mockResolvedValue(configs),
        listHeartbeats: vi.fn().mockResolvedValue(heartbeats)
      }
    };
    const restoreEnabled = vi.fn().mockResolvedValue(runtime);
    const listRuntime = vi.fn().mockReturnValue(runtime);
    mocks.getWorldModelServices.mockReturnValue(services);
    mocks.getEvidenceLoopWorkerController.mockReturnValue({
      restoreEnabled,
      listRuntime
    });
    const { GET } = await import("@/app/api/automation/worker/route");

    const response = await GET(new Request("http://localhost/api/automation/worker", { method: "GET" }));

    expect(response.status).toBe(200);
    expect(restoreEnabled).toHaveBeenCalledWith(services);
    await expect(response.json()).resolves.toEqual({
      runtime: JSON.parse(JSON.stringify(runtime)),
      configs: JSON.parse(JSON.stringify(configs)),
      heartbeats: JSON.parse(JSON.stringify(heartbeats))
    });
  });

  it("returns persisted worker status when runtime restore fails", async () => {
    const configs = [
      {
        id: "default",
        enabled: true,
        intervalMs: 900_000,
        failureBackoffMultiplier: 2,
        maxIntervalMs: 3_600_000,
        reviewOnly: true,
        maxQueries: 3,
        maxSources: 2,
        beliefIds: ["belief_ai_agents"],
        sourceIds: ["source_github"],
        maxObservations: 20,
        candidateThreshold: 0.25,
        autoConfirmThreshold: 0.85,
        bootstrapDefaultSources: true,
        forceAutoApply: false,
        createdAt: new Date("2026-06-12T00:00:00.000Z"),
        updatedAt: new Date("2026-06-12T00:00:00.000Z")
      }
    ];
    const heartbeats = [
      {
        id: "default",
        status: "ERROR",
        heartbeatAt: new Date("2026-06-12T00:01:00.000Z"),
        intervalMs: 900_000,
        consecutiveFailureCount: 1,
        lastError: "previous run failed",
        createdAt: new Date("2026-06-12T00:01:00.000Z"),
        updatedAt: new Date("2026-06-12T00:01:00.000Z")
      }
    ];
    const services = {
      automation: {
        listWorkerConfigs: vi.fn().mockResolvedValue(configs),
        listHeartbeats: vi.fn().mockResolvedValue(heartbeats)
      }
    };
    const restoreEnabled = vi.fn().mockRejectedValue(new Error("timer startup failed"));
    const listRuntime = vi.fn().mockReturnValue([]);
    mocks.getWorldModelServices.mockReturnValue(services);
    mocks.getEvidenceLoopWorkerController.mockReturnValue({
      restoreEnabled,
      listRuntime
    });
    const { GET } = await import("@/app/api/automation/worker/route");

    const response = await GET(new Request("http://localhost/api/automation/worker", { method: "GET" }));

    expect(response.status).toBe(200);
    expect(restoreEnabled).toHaveBeenCalledWith(services);
    await expect(response.json()).resolves.toEqual({
      runtime: [],
      configs: JSON.parse(JSON.stringify(configs)),
      heartbeats: JSON.parse(JSON.stringify(heartbeats)),
      restoreError: "自动化守护进程恢复失败：timer startup failed"
    });
  });

  it("starts a persisted worker with loop options derived from its config", async () => {
    const config = {
      id: "nightly",
      enabled: true,
      intervalMs: 600_000,
      failureBackoffMultiplier: 3,
      maxIntervalMs: 3_600_000,
      reviewOnly: false,
      maxQueries: 4,
      maxSources: 2,
      beliefIds: ["belief_ai_agents", "belief_career"],
      sourceIds: ["source_github", "source_hf"],
      maxObservations: 12,
      candidateThreshold: 0.3,
      autoConfirmThreshold: 0.82,
      bootstrapDefaultSources: true,
      forceAutoApply: true,
      createdAt: new Date("2026-06-12T00:00:00.000Z"),
      updatedAt: new Date("2026-06-12T00:00:00.000Z")
    };
    const saveWorkerConfig = vi.fn().mockResolvedValue(config);
    const start = vi.fn().mockResolvedValue({ workerId: "nightly", running: true });
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs: vi.fn().mockResolvedValue(effectiveBeliefs())
      },
      automation: {
        saveWorkerConfig
      }
    });
    mocks.getEvidenceLoopWorkerController.mockReturnValue({ start });
    const { POST } = await import("@/app/api/automation/worker/route");
    const body = {
      id: "nightly",
      intervalMs: 600_000,
      failureBackoffMultiplier: 3,
      maxIntervalMs: 3_600_000,
      reviewOnly: false,
      maxQueries: 4,
      maxSources: 2,
      beliefIds: ["belief_ai_agents", "belief_career"],
      sourceIds: ["source_github", "source_hf"],
      maxObservations: 12,
      candidateThreshold: 0.3,
      autoConfirmThreshold: 0.82,
      bootstrapDefaultSources: true,
      forceAutoApply: true,
      runImmediately: false
    };

    const response = await POST(
      new Request("http://localhost/api/automation/worker", {
        method: "POST",
        body: JSON.stringify(body)
      })
    );

    await expect(response.json()).resolves.toEqual({
      config: JSON.parse(JSON.stringify(config)),
      runtime: { workerId: "nightly", running: true }
    });
    expect(response.status).toBe(201);
    expect(saveWorkerConfig).toHaveBeenCalledWith({
      id: "nightly",
      enabled: true,
      intervalMs: 600_000,
      failureBackoffMultiplier: 3,
      maxIntervalMs: 3_600_000,
      reviewOnly: false,
      maxQueries: 4,
      maxSources: 2,
      beliefIds: ["belief_ai_agents", "belief_career"],
      sourceIds: ["source_github", "source_hf"],
      maxObservations: 12,
      candidateThreshold: 0.3,
      autoConfirmThreshold: 0.82,
      bootstrapDefaultSources: true,
      forceAutoApply: true
    });
    expect(start).toHaveBeenCalledWith(
      {
        workerId: "nightly",
        intervalMs: 600_000,
        failureBackoffMultiplier: 3,
        maxIntervalMs: 3_600_000,
        runImmediately: false,
        loopOptions: {
          reviewOnly: false,
          maxQueries: 4,
          maxSources: 2,
          beliefIds: ["belief_ai_agents", "belief_career"],
          sourceIds: ["source_github", "source_hf"],
          maxObservations: 12,
          candidateThreshold: 0.3,
          autoConfirmThreshold: 0.82,
          bootstrapDefaultSources: true,
          forceAutoApply: true
        }
      },
      expect.objectContaining({ automation: expect.objectContaining({ saveWorkerConfig }) })
    );
  });

  it("defaults a new worker to guarded auto-apply mode and immediately runs the loop", async () => {
    const saveWorkerConfig = vi.fn().mockImplementation(async (input) => ({
      ...input,
      createdAt: new Date("2026-06-12T00:00:00.000Z"),
      updatedAt: new Date("2026-06-12T00:00:00.000Z")
    }));
    const start = vi.fn().mockResolvedValue({ workerId: "default", running: true });
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs: vi.fn().mockResolvedValue(effectiveBeliefs())
      },
      automation: {
        saveWorkerConfig
      }
    });
    mocks.getEvidenceLoopWorkerController.mockReturnValue({ start });
    const { POST } = await import("@/app/api/automation/worker/route");

    const response = await POST(
      new Request("http://localhost/api/automation/worker", {
        method: "POST",
        body: JSON.stringify({})
      })
    );

    expect(response.status).toBe(201);
    expect(saveWorkerConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "default",
        enabled: true,
        reviewOnly: false,
        forceAutoApply: true,
        bootstrapDefaultSources: true
      })
    );
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        runImmediately: true,
        loopOptions: expect.objectContaining({
          reviewOnly: false,
          forceAutoApply: true,
          bootstrapDefaultSources: true
        })
      }),
      expect.objectContaining({ automation: expect.objectContaining({ saveWorkerConfig }) })
    );
  });

  it("downgrades requested auto-apply workers when LLM evaluation quality is risky", async () => {
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact({ reviewRequiredRate: 0.46 }));
    const saveWorkerConfig = vi.fn().mockImplementation(async (input) => ({
      ...input,
      createdAt: new Date("2026-06-12T00:00:00.000Z"),
      updatedAt: new Date("2026-06-12T00:00:00.000Z")
    }));
    const start = vi.fn().mockResolvedValue({ workerId: "nightly", running: true });
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs: vi.fn().mockResolvedValue(effectiveBeliefs())
      },
      automation: {
        saveWorkerConfig
      }
    });
    mocks.getEvidenceLoopWorkerController.mockReturnValue({ start });
    const { POST } = await import("@/app/api/automation/worker/route");

    const response = await POST(
      new Request("http://localhost/api/automation/worker", {
        method: "POST",
        body: JSON.stringify({
          id: "nightly",
          intervalMs: 600_000,
          reviewOnly: false,
          maxQueries: 4,
          maxSources: 2,
          beliefIds: ["belief_ai_agents"],
          sourceIds: ["source_github"],
          maxObservations: 12,
          candidateThreshold: 0.3,
          autoConfirmThreshold: 0.82,
          bootstrapDefaultSources: true,
          forceAutoApply: true,
          runImmediately: false
        })
      })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      config: expect.objectContaining({
        id: "nightly",
        reviewOnly: true,
        forceAutoApply: false
      }),
      runtime: { workerId: "nightly", running: true },
      notice: "LLM 评估风险：LLM 评估复核率偏高，已切换为待审模式。"
    });
    expect(saveWorkerConfig).toHaveBeenCalledWith({
      id: "nightly",
      enabled: true,
      intervalMs: 600_000,
      failureBackoffMultiplier: 2,
      maxIntervalMs: 3_600_000,
      reviewOnly: true,
      maxQueries: 4,
      maxSources: 2,
      beliefIds: ["belief_ai_agents"],
      sourceIds: ["source_github"],
      maxObservations: 12,
      candidateThreshold: 0.3,
      autoConfirmThreshold: 0.82,
      bootstrapDefaultSources: true,
      forceAutoApply: false
    });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        loopOptions: expect.objectContaining({
          reviewOnly: true,
          forceAutoApply: false
        })
      }),
      expect.objectContaining({ automation: expect.objectContaining({ saveWorkerConfig }) })
    );
  });

  it("downgrades requested auto-apply workers when no hypothesis is currently effective", async () => {
    const saveWorkerConfig = vi.fn().mockImplementation(async (input) => ({
      ...input,
      createdAt: new Date("2026-06-12T00:00:00.000Z"),
      updatedAt: new Date("2026-06-12T00:00:00.000Z")
    }));
    const start = vi.fn().mockResolvedValue({ workerId: "nightly", running: true });
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
        saveWorkerConfig
      }
    });
    mocks.getEvidenceLoopWorkerController.mockReturnValue({ start });
    const { POST } = await import("@/app/api/automation/worker/route");

    const response = await POST(
      new Request("http://localhost/api/automation/worker", {
        method: "POST",
        body: JSON.stringify({
          id: "nightly",
          intervalMs: 600_000,
          reviewOnly: false,
          maxQueries: 4,
          maxSources: 2,
          beliefIds: ["belief_ai_agents"],
          sourceIds: ["source_github"],
          maxObservations: 12,
          candidateThreshold: 0.3,
          autoConfirmThreshold: 0.82,
          bootstrapDefaultSources: true,
          forceAutoApply: true,
          runImmediately: false
        })
      })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      config: expect.objectContaining({
        id: "nightly",
        reviewOnly: true,
        forceAutoApply: false
      }),
      runtime: { workerId: "nightly", running: true },
      notice: "没有当前有效假设，已切换为待审模式。"
    });
    expect(saveWorkerConfig).toHaveBeenCalledWith({
      id: "nightly",
      enabled: true,
      intervalMs: 600_000,
      failureBackoffMultiplier: 2,
      maxIntervalMs: 3_600_000,
      reviewOnly: true,
      maxQueries: 4,
      maxSources: 2,
      beliefIds: ["belief_ai_agents"],
      sourceIds: ["source_github"],
      maxObservations: 12,
      candidateThreshold: 0.3,
      autoConfirmThreshold: 0.82,
      bootstrapDefaultSources: true,
      forceAutoApply: false
    });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        loopOptions: expect.objectContaining({
          reviewOnly: true,
          forceAutoApply: false
        })
      }),
      expect.objectContaining({ automation: expect.objectContaining({ saveWorkerConfig }) })
    );
  });

  it("downgrades requested auto-apply workers when hypothesis coverage is one-sided", async () => {
    const saveWorkerConfig = vi.fn().mockImplementation(async (input) => ({
      ...input,
      createdAt: new Date("2026-06-12T00:00:00.000Z"),
      updatedAt: new Date("2026-06-12T00:00:00.000Z")
    }));
    const start = vi.fn().mockResolvedValue({ workerId: "nightly", running: true });
    mocks.getWorldModelServices.mockReturnValue({
      beliefs: {
        listBeliefs: vi.fn().mockResolvedValue(oneSidedBeliefs())
      },
      automation: {
        saveWorkerConfig
      }
    });
    mocks.getEvidenceLoopWorkerController.mockReturnValue({ start });
    const { POST } = await import("@/app/api/automation/worker/route");

    const response = await POST(
      new Request("http://localhost/api/automation/worker", {
        method: "POST",
        body: JSON.stringify({
          id: "nightly",
          intervalMs: 600_000,
          reviewOnly: false,
          maxQueries: 4,
          maxSources: 2,
          beliefIds: ["belief_ai_agents"],
          sourceIds: ["source_github"],
          maxObservations: 12,
          candidateThreshold: 0.3,
          autoConfirmThreshold: 0.82,
          bootstrapDefaultSources: true,
          forceAutoApply: true,
          runImmediately: false
        })
      })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      config: expect.objectContaining({
        id: "nightly",
        reviewOnly: true,
        forceAutoApply: false
      }),
      runtime: { workerId: "nightly", running: true },
      notice: "假设覆盖单向，已切换为待审模式。"
    });
    expect(saveWorkerConfig).toHaveBeenCalledWith({
      id: "nightly",
      enabled: true,
      intervalMs: 600_000,
      failureBackoffMultiplier: 2,
      maxIntervalMs: 3_600_000,
      reviewOnly: true,
      maxQueries: 4,
      maxSources: 2,
      beliefIds: ["belief_ai_agents"],
      sourceIds: ["source_github"],
      maxObservations: 12,
      candidateThreshold: 0.3,
      autoConfirmThreshold: 0.82,
      bootstrapDefaultSources: true,
      forceAutoApply: false
    });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        loopOptions: expect.objectContaining({
          reviewOnly: true,
          forceAutoApply: false
        })
      }),
      expect.objectContaining({ automation: expect.objectContaining({ saveWorkerConfig }) })
    );
  });

  it("stops a worker and disables its persisted config when one exists", async () => {
    const existing = {
      id: "default",
      enabled: true,
      intervalMs: 900_000,
      failureBackoffMultiplier: 2,
      maxIntervalMs: 3_600_000,
      reviewOnly: true,
      maxQueries: 3,
      maxSources: 2,
      beliefIds: ["belief_ai_agents"],
      sourceIds: ["source_github"],
      maxObservations: 20,
      candidateThreshold: 0.25,
      autoConfirmThreshold: 0.85,
      bootstrapDefaultSources: true,
      forceAutoApply: false,
      createdAt: new Date("2026-06-12T00:00:00.000Z"),
      updatedAt: new Date("2026-06-12T00:00:00.000Z")
    };
    const disabled = { ...existing, enabled: false, updatedAt: new Date("2026-06-12T00:02:00.000Z") };
    const listWorkerConfigs = vi.fn().mockResolvedValue([existing]);
    const saveWorkerConfig = vi.fn().mockResolvedValue(disabled);
    const stop = vi.fn().mockResolvedValue(undefined);
    mocks.getWorldModelServices.mockReturnValue({
      automation: {
        listWorkerConfigs,
        saveWorkerConfig
      }
    });
    mocks.getEvidenceLoopWorkerController.mockReturnValue({ stop });
    const { DELETE } = await import("@/app/api/automation/worker/route");

    const response = await DELETE(
      new Request("http://localhost/api/automation/worker", {
        method: "DELETE",
        body: JSON.stringify({ workerId: "default" })
      })
    );

    await expect(response.json()).resolves.toEqual({ workerId: "default", config: JSON.parse(JSON.stringify(disabled)) });
    expect(response.status).toBe(200);
    expect(saveWorkerConfig).toHaveBeenCalledWith({
      id: "default",
      enabled: false,
      intervalMs: 900_000,
      failureBackoffMultiplier: 2,
      maxIntervalMs: 3_600_000,
      reviewOnly: true,
      maxQueries: 3,
      maxSources: 2,
      beliefIds: ["belief_ai_agents"],
      sourceIds: ["source_github"],
      maxObservations: 20,
      candidateThreshold: 0.25,
      autoConfirmThreshold: 0.85,
      bootstrapDefaultSources: true,
      forceAutoApply: false
    });
    expect(stop).toHaveBeenCalledWith("default", expect.objectContaining({ automation: expect.objectContaining({ listWorkerConfigs }) }));
  });
});
