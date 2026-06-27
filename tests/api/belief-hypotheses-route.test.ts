import { vi } from "vitest";

const getWorldModelServices = vi.fn();

vi.mock("@/server/services", () => ({
  getWorldModelServices
}));

describe("belief hypotheses route", () => {
  beforeEach(() => {
    getWorldModelServices.mockReset();
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
  });

  it("creates a hypothesis under a belief from API input", async () => {
    const hypothesis = {
      id: "hypothesis_new",
      beliefId: "belief_signal",
      proposition: "New observations strengthen the signal",
      currentProbability: 0.42
    };
    const createHypothesis = vi.fn().mockResolvedValue(hypothesis);
    getWorldModelServices.mockReturnValue({
      beliefs: {
        createHypothesis
      }
    });
    const { POST } = await import("@/app/api/beliefs/[id]/hypotheses/route");
    const body = {
      proposition: "New observations strengthen the signal",
      priorProbability: 0.42,
      stance: "SUPPORTS",
      notes: "Track source-driven updates."
    };

    const response = await POST(
      new Request("http://localhost/api/beliefs/belief_signal/hypotheses", {
        method: "POST",
        body: JSON.stringify(body)
      }),
      { params: Promise.resolve({ id: "belief_signal" }) }
    );

    await expect(response.json()).resolves.toEqual(hypothesis);
    expect(response.status).toBe(201);
    expect(createHypothesis).toHaveBeenCalledWith("belief_signal", body);
  });
});
