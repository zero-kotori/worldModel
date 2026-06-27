import { vi } from "vitest";

const getWorldModelServices = vi.fn();

vi.mock("@/server/services", () => ({
  getWorldModelServices
}));

describe("hypothesis update route", () => {
  beforeEach(() => {
    getWorldModelServices.mockReset();
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
  });

  it("updates a hypothesis and coerces JSON date fields", async () => {
    const startsAt = "2026-06-12T10:00:00.000Z";
    const hypothesis = {
      id: "hypothesis_signal",
      proposition: "Updated hypothesis",
      startsAt: new Date(startsAt)
    };
    const updateHypothesis = vi.fn().mockResolvedValue(hypothesis);
    getWorldModelServices.mockReturnValue({
      beliefs: {
        updateHypothesis
      }
    });
    const { PATCH } = await import("@/app/api/hypotheses/[id]/route");
    const body = {
      proposition: "Updated hypothesis",
      currentProbability: 0.57,
      startsAt,
      expiresAt: null,
      expiryCondition: "Stop tracking after the review window closes."
    };

    const response = await PATCH(
      new Request("http://localhost/api/hypotheses/hypothesis_signal", {
        method: "PATCH",
        body: JSON.stringify(body)
      }),
      { params: Promise.resolve({ id: "hypothesis_signal" }) }
    );

    await expect(response.json()).resolves.toEqual({
      ...hypothesis,
      startsAt
    });
    expect(response.status).toBe(200);
    expect(updateHypothesis).toHaveBeenCalledWith("hypothesis_signal", {
      ...body,
      startsAt: new Date(startsAt)
    });
  });
});
