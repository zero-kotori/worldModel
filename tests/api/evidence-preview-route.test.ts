import { vi } from "vitest";

const getWorldModelServices = vi.fn();

vi.mock("@/server/services", () => ({
  getWorldModelServices
}));

describe("evidence preview update route", () => {
  beforeEach(() => {
    getWorldModelServices.mockReset();
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
  });

  it("returns grouped previews for evidence spanning multiple beliefs", async () => {
    const previews = [
      {
        evidenceId: "evidence_cross",
        beliefId: "belief_adoption",
        mode: "INDEPENDENT",
        priorSnapshot: { hypothesis_quality: 0.4 },
        posteriorSnapshot: { hypothesis_quality: 0.57 },
        links: [{ hypothesisId: "hypothesis_quality", likelihoodRatio: 2, credibility: 0.8, confidence: 0.8, rationale: "Quality signal." }],
        explanations: ["hypothesis_quality: Quality signal."],
        reviewRequired: false,
        confidence: 0.8
      },
      {
        evidenceId: "evidence_cross",
        beliefId: "belief_career",
        mode: "INDEPENDENT",
        priorSnapshot: { hypothesis_overhead: 0.6 },
        posteriorSnapshot: { hypothesis_overhead: 0.43 },
        links: [{ hypothesisId: "hypothesis_overhead", likelihoodRatio: 0.5, credibility: 0.8, confidence: 0.7, rationale: "Overhead signal." }],
        explanations: ["hypothesis_overhead: Overhead signal."],
        reviewRequired: false,
        confidence: 0.7
      }
    ];
    const createPreviews = vi.fn().mockResolvedValue(previews);
    getWorldModelServices.mockReturnValue({
      updates: { createPreviews }
    });
    const { POST } = await import("@/app/api/evidence/[id]/preview-update/route");

    const response = await POST(new Request("http://localhost/api/evidence/evidence_cross/preview-update", { method: "POST" }), {
      params: Promise.resolve({ id: "evidence_cross" })
    });

    await expect(response.json()).resolves.toEqual({ previews });
    expect(response.status).toBe(200);
    expect(createPreviews).toHaveBeenCalledWith("evidence_cross");
  });
});
