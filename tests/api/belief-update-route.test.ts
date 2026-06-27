import { vi } from "vitest";

const getWorldModelServices = vi.fn();

vi.mock("@/server/services", () => ({
  getWorldModelServices
}));

describe("belief update route", () => {
  beforeEach(() => {
    getWorldModelServices.mockReset();
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
  });

  it("updates a belief from API input", async () => {
    const belief = {
      id: "belief_signal",
      title: "Updated signal belief",
      status: "PAUSED"
    };
    const updateBelief = vi.fn().mockResolvedValue(belief);
    getWorldModelServices.mockReturnValue({
      beliefs: {
        updateBelief
      }
    });
    const { PATCH } = await import("@/app/api/beliefs/[id]/route");
    const body = {
      title: "Updated signal belief",
      status: "PAUSED",
      description: "Automation paused this belief while evidence quality is reviewed."
    };

    const response = await PATCH(
      new Request("http://localhost/api/beliefs/belief_signal", {
        method: "PATCH",
        body: JSON.stringify(body)
      }),
      { params: Promise.resolve({ id: "belief_signal" }) }
    );

    await expect(response.json()).resolves.toEqual(belief);
    expect(response.status).toBe(200);
    expect(updateBelief).toHaveBeenCalledWith("belief_signal", body);
  });
});
