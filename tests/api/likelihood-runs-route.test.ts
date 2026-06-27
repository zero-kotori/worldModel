import { vi } from "vitest";

const getWorldModelServices = vi.fn();

vi.mock("@/server/services", () => ({
  getWorldModelServices
}));

describe("likelihood runs route", () => {
  beforeEach(() => {
    getWorldModelServices.mockReset();
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
  });

  it("returns likelihood scoring runs for model audit", async () => {
    const runs = [
      {
        id: "likelihood_signal",
        evidenceId: "evidence_signal",
        hypothesisId: "hypothesis_signal",
        ensembleLikelihoodRatio: 2.4,
        ensembleConfidence: 0.78,
        estimatorOutputs: [
          {
            estimator: "llm",
            likelihoodRatio: 2.4,
            confidence: 0.78,
            weight: 3,
            rationale: "The evidence semantically supports the hypothesis.",
            modelVersion: "deepseek:deepseek-chat"
          }
        ],
        modelVersion: "deepseek:deepseek-chat",
        createdAt: new Date("2026-06-12T03:00:00.000Z")
      }
    ];
    const listRuns = vi.fn().mockResolvedValue(runs);
    getWorldModelServices.mockReturnValue({
      likelihood: {
        listRuns
      }
    });
    const { GET } = await import("@/app/api/likelihood-runs/route");

    const response = await GET(new Request("http://localhost/api/likelihood-runs", { method: "GET" }));

    await expect(response.json()).resolves.toEqual(JSON.parse(JSON.stringify(runs)));
    expect(response.status).toBe(200);
    expect(listRuns).toHaveBeenCalledWith();
  });
});
