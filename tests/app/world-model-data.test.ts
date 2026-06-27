import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorldModelServices: vi.fn(),
  getEvidenceLoopWorkerController: vi.fn(),
  loadLlmEvaluationArtifact: vi.fn()
}));

vi.mock("server-only", () => ({}));

vi.mock("@/server/services", () => ({
  getWorldModelServices: mocks.getWorldModelServices
}));

vi.mock("@/server/automation/local-worker", () => ({
  getEvidenceLoopWorkerController: mocks.getEvidenceLoopWorkerController
}));

vi.mock("@/server/training/llm-evaluation-artifact", () => ({
  loadLlmEvaluationArtifact: mocks.loadLlmEvaluationArtifact
}));

function worldModelServices() {
  const createdAt = new Date("2026-06-18T00:00:00.000Z");
  return {
    beliefs: {
      listBeliefs: vi.fn().mockResolvedValue([
        {
          id: "belief_signal",
          title: "Automation resilience",
          category: "AI_TREND",
          description: "",
          probabilityMode: "INDEPENDENT",
          status: "ACTIVE",
          createdAt,
          updatedAt: createdAt,
          hypotheses: []
        }
      ])
    },
    observations: { listObservations: vi.fn().mockResolvedValue([]) },
    evidence: { listEvidence: vi.fn().mockResolvedValue([]) },
    sources: {
      listSources: vi.fn().mockResolvedValue([]),
      listRuns: vi.fn().mockResolvedValue([])
    },
    automation: {
      listHeartbeats: vi.fn().mockResolvedValue([]),
      listWorkerConfigs: vi.fn().mockResolvedValue([])
    },
    models: { listArtifacts: vi.fn().mockResolvedValue([]) },
    updates: { listEvents: vi.fn().mockResolvedValue([]) },
    likelihood: { listRuns: vi.fn().mockResolvedValue([]) }
  };
}

describe("world model data loader", () => {
  const previousDatabaseUrl = process.env.WORLDMODEL_DATABASE_URL;

  beforeEach(() => {
    process.env.WORLDMODEL_DATABASE_URL = "postgresql://test";
    mocks.getWorldModelServices.mockReset();
    mocks.getEvidenceLoopWorkerController.mockReset();
    mocks.loadLlmEvaluationArtifact.mockReset();
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(null);
  });

  afterAll(() => {
    if (previousDatabaseUrl === undefined) {
      delete process.env.WORLDMODEL_DATABASE_URL;
    } else {
      process.env.WORLDMODEL_DATABASE_URL = previousDatabaseUrl;
    }
  });

  it("keeps page data available when worker restore fails", async () => {
    const services = worldModelServices();
    const restoreEnabled = vi.fn().mockRejectedValue(new Error("timer startup failed"));
    mocks.getWorldModelServices.mockReturnValue(services);
    mocks.getEvidenceLoopWorkerController.mockReturnValue({ restoreEnabled });
    const { loadWorldModelData } = await import("@/app/admin/world-model/data");

    const data = await loadWorldModelData();

    expect(data.beliefs).toHaveLength(1);
    expect(data.beliefs[0].title).toBe("Automation resilience");
    expect(data.workerRuntime).toEqual([]);
    expect(data.error).toBe("自动化守护进程恢复失败：timer startup failed");
    expect(restoreEnabled).toHaveBeenCalledWith(services);
  });

  it("keeps page data available when LLM evaluation loading fails", async () => {
    const services = worldModelServices();
    const restoreEnabled = vi.fn().mockResolvedValue([]);
    mocks.loadLlmEvaluationArtifact.mockRejectedValue(new Error("artifact read failed"));
    mocks.getWorldModelServices.mockReturnValue(services);
    mocks.getEvidenceLoopWorkerController.mockReturnValue({ restoreEnabled });
    const { loadWorldModelData } = await import("@/app/admin/world-model/data");

    const data = await loadWorldModelData();

    expect(data.beliefs).toHaveLength(1);
    expect(data.beliefs[0].title).toBe("Automation resilience");
    expect(data.llmEvaluation).toBeNull();
    expect(data.error).toBe("LLM 评估加载失败：artifact read failed");
    expect(restoreEnabled).toHaveBeenCalledWith(services);
  });
});
