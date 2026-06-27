import { vi } from "vitest";

const getWorldModelServices = vi.fn();

vi.mock("@/server/services", () => ({
  getWorldModelServices
}));

describe("observation update route", () => {
  beforeEach(() => {
    getWorldModelServices.mockReset();
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
  });

  it("updates an observation through the service so recommendation links can be refreshed", async () => {
    const updatedObservation = {
      id: "observation_signal",
      title: "Updated signal observation",
      content: "The edited observation now clearly matches the signal hypothesis.",
      url: "https://example.com/updated-signal",
      credibility: 0.86,
      metadata: {
        reviewedBy: "external-automation",
        recommendedLinks: [{ hypothesisId: "hypothesis_signal", direction: "SUPPORTS" }]
      }
    };
    const updateObservation = vi.fn().mockResolvedValue(updatedObservation);
    getWorldModelServices.mockReturnValue({
      observations: {
        updateObservation
      }
    });
    const { PATCH } = await import("@/app/api/observations/[id]/route");
    const body = {
      title: "Updated signal observation",
      content: "The edited observation now clearly matches the signal hypothesis.",
      url: "https://example.com/updated-signal",
      credibility: 0.86,
      metadata: { reviewedBy: "external-automation" }
    };

    const response = await PATCH(
      new Request("http://localhost/api/observations/observation_signal", {
        method: "PATCH",
        body: JSON.stringify(body)
      }),
      { params: Promise.resolve({ id: "observation_signal" }) }
    );

    await expect(response.json()).resolves.toEqual(updatedObservation);
    expect(response.status).toBe(200);
    expect(updateObservation).toHaveBeenCalledWith("observation_signal", body);
  });
});
