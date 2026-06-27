import { vi } from "vitest";

const getWorldModelServices = vi.fn();

vi.mock("@/server/services", () => ({
  getWorldModelServices
}));

describe("belief recommendation route", () => {
  beforeEach(() => {
    getWorldModelServices.mockReset();
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
  });

  it("passes source observation scope into hypothesis recommendations", async () => {
    const recommendations = [
      {
        proposition: "Agent adoption signal continues into the next quarter.",
        stance: "SUPPORTS",
        priorProbability: 0.55,
        notes: "Derived from unmatched observation.",
        evidenceSearchQuery: "Agent adoption signal",
        rationale: "来自未匹配观察：Agent adoption signal",
        sourceObservationId: "observation_unmatched"
      }
    ];
    const recommendHypotheses = vi.fn().mockResolvedValue(recommendations);
    getWorldModelServices.mockReturnValue({
      beliefs: {
        recommendHypotheses
      }
    });
    const { GET } = await import("@/app/api/beliefs/[id]/hypothesis-recommendations/route");

    const response = await GET(
      new Request(
        "http://localhost/api/beliefs/belief_ai_agents/hypothesis-recommendations?limit=2&sourceObservationId=observation_unmatched"
      ),
      { params: Promise.resolve({ id: "belief_ai_agents" }) }
    );

    await expect(response.json()).resolves.toEqual(recommendations);
    expect(response.status).toBe(200);
    expect(recommendHypotheses).toHaveBeenCalledWith("belief_ai_agents", {
      limit: 2,
      sourceObservationId: "observation_unmatched"
    });
  });

  it("resolves readable source observation codes before requesting recommendations", async () => {
    const recommendations = [
      {
        proposition: "Readable observation codes can drive focused hypothesis review.",
        stance: "SUPPORTS",
        priorProbability: 0.6,
        notes: "Derived from O-001.",
        evidenceSearchQuery: "readable observation code",
        rationale: "来自未匹配观察：Readable observation code",
        sourceObservationId: "observation_unmatched"
      }
    ];
    const recommendHypotheses = vi.fn().mockResolvedValue(recommendations);
    const listObservations = vi.fn().mockResolvedValue([
      {
        id: "observation_unmatched",
        observedAt: new Date("2026-06-18T08:00:00.000Z")
      }
    ]);
    getWorldModelServices.mockReturnValue({
      beliefs: {
        recommendHypotheses
      },
      observations: {
        listObservations
      }
    });
    const { GET } = await import("@/app/api/beliefs/[id]/hypothesis-recommendations/route");

    const response = await GET(
      new Request("http://localhost/api/beliefs/belief_ai_agents/hypothesis-recommendations?sourceObservation=O-001"),
      { params: Promise.resolve({ id: "belief_ai_agents" }) }
    );

    await expect(response.json()).resolves.toEqual(recommendations);
    expect(response.status).toBe(200);
    expect(recommendHypotheses).toHaveBeenCalledWith("belief_ai_agents", {
      limit: undefined,
      sourceObservationId: "observation_unmatched"
    });
  });
});
