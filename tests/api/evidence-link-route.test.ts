import { vi } from "vitest";

const getWorldModelServices = vi.fn();

vi.mock("@/server/services", () => ({
  getWorldModelServices
}));

describe("evidence link route", () => {
  beforeEach(() => {
    getWorldModelServices.mockReset();
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
  });

  it("connects evidence to a hypothesis and reapplies affected updates", async () => {
    const result = {
      evidence: {
        id: "evidence_signal",
        links: [{ hypothesisId: "hypothesis_signal" }]
      },
      events: [
        {
          id: "update_event",
          evidenceId: "evidence_signal",
          beliefId: "belief_signal"
        }
      ]
    };
    const connectHypothesis = vi.fn().mockResolvedValue(result);
    getWorldModelServices.mockReturnValue({
      evidence: {
        connectHypothesis
      }
    });
    const { POST } = await import("@/app/api/evidence/[id]/link/route");
    const body = {
      hypothesisId: "hypothesis_signal",
      direction: "SUPPORTS",
      relevance: 0.82,
      likelihoodRatio: 2.4,
      confidence: 0.76,
      rationale: "External automation connected this evidence to the signal hypothesis."
    };

    const response = await POST(
      new Request("http://localhost/api/evidence/evidence_signal/link", {
        method: "POST",
        body: JSON.stringify(body)
      }),
      { params: Promise.resolve({ id: "evidence_signal" }) }
    );

    await expect(response.json()).resolves.toEqual(result);
    expect(response.status).toBe(201);
    expect(connectHypothesis).toHaveBeenCalledWith("evidence_signal", body);
  });

  it("disconnects evidence from a hypothesis and reapplies affected updates", async () => {
    const result = {
      evidence: {
        id: "evidence_signal",
        links: [{ hypothesisId: "hypothesis_remaining" }]
      },
      events: [
        {
          id: "update_event",
          evidenceId: "evidence_signal",
          beliefId: "belief_remaining"
        }
      ]
    };
    const disconnectHypothesis = vi.fn().mockResolvedValue(result);
    getWorldModelServices.mockReturnValue({
      evidence: {
        disconnectHypothesis
      }
    });
    const { DELETE } = await import("@/app/api/evidence/[id]/link/route");
    const body = {
      hypothesisId: "hypothesis_signal"
    };

    const response = await DELETE(
      new Request("http://localhost/api/evidence/evidence_signal/link", {
        method: "DELETE",
        body: JSON.stringify(body)
      }),
      { params: Promise.resolve({ id: "evidence_signal" }) }
    );

    await expect(response.json()).resolves.toEqual(result);
    expect(response.status).toBe(200);
    expect(disconnectHypothesis).toHaveBeenCalledWith("evidence_signal", body);
  });
});
