import { vi } from "vitest";

const getWorldModelServices = vi.fn();

vi.mock("@/server/services", () => ({
  getWorldModelServices
}));

describe("updates list route", () => {
  beforeEach(() => {
    getWorldModelServices.mockReset();
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
  });

  it("returns bayesian update events for external audit and synchronization", async () => {
    const events = [
      {
        id: "update_event_signal",
        beliefId: "belief_signal",
        evidenceId: "evidence_signal",
        priorSnapshot: { hypothesis_signal: 0.35 },
        posteriorSnapshot: { hypothesis_signal: 0.58 },
        mode: "APPLIED",
        status: "APPLIED",
        confidence: 0.78,
        explanations: ["Evidence increased the signal hypothesis."],
        createdAt: new Date("2026-06-12T02:00:00.000Z")
      }
    ];
    const listEvents = vi.fn().mockResolvedValue(events);
    getWorldModelServices.mockReturnValue({
      updates: {
        listEvents
      }
    });
    const { GET } = await import("@/app/api/updates/route");

    const response = await GET(new Request("http://localhost/api/updates", { method: "GET" }));

    await expect(response.json()).resolves.toEqual(JSON.parse(JSON.stringify(events)));
    expect(response.status).toBe(200);
    expect(listEvents).toHaveBeenCalledWith();
  });
});
