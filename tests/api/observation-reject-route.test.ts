import { vi } from "vitest";

const getWorldModelServices = vi.fn();

vi.mock("@/server/services", () => ({
  getWorldModelServices
}));

describe("observation reject route", () => {
  beforeEach(() => {
    getWorldModelServices.mockReset();
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
  });

  it("rejects an observation without requiring hypothesis ids", async () => {
    const rejectedObservation = {
      id: "observation_noise",
      status: "REJECTED",
      title: "Noisy observation"
    };
    const rejectObservation = vi.fn().mockResolvedValue(rejectedObservation);
    getWorldModelServices.mockReturnValue({
      observations: {
        rejectObservation
      }
    });
    const { POST } = await import("@/app/api/observations/[id]/reject/route");

    const response = await POST(new Request("http://localhost/api/observations/observation_noise/reject", { method: "POST" }), {
      params: Promise.resolve({ id: "observation_noise" })
    });

    await expect(response.json()).resolves.toEqual(rejectedObservation);
    expect(response.status).toBe(200);
    expect(rejectObservation).toHaveBeenCalledWith("observation_noise");
  });
});
