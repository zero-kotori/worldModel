import { vi } from "vitest";

const getWorldModelServices = vi.fn();

vi.mock("@/server/services", () => ({
  getWorldModelServices
}));

describe("evidence update route", () => {
  beforeEach(() => {
    getWorldModelServices.mockReset();
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
  });

  it("updates evidence links and reapplies affected beliefs", async () => {
    const result = {
      evidence: {
        id: "evidence_signal",
        title: "Updated evidence",
        links: [{ hypothesisId: "hypothesis_signal", likelihoodRatio: 2.1 }]
      },
      events: [
        {
          id: "event_signal",
          evidenceId: "evidence_signal",
          beliefId: "belief_signal"
        }
      ]
    };
    const updateAndReapply = vi.fn().mockResolvedValue(result);
    getWorldModelServices.mockReturnValue({
      evidence: {
        updateAndReapply
      }
    });
    const { PATCH } = await import("@/app/api/evidence/[id]/route");
    const body = {
      title: "Updated evidence",
      content: "The observed signal now has stronger support.",
      credibility: 0.84,
      links: [
        {
          hypothesisId: "hypothesis_signal",
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2.1,
          confidence: 0.78,
          rationale: "The edited evidence directly supports the signal hypothesis."
        }
      ]
    };

    const response = await PATCH(
      new Request("http://localhost/api/evidence/evidence_signal", {
        method: "PATCH",
        body: JSON.stringify(body)
      }),
      { params: Promise.resolve({ id: "evidence_signal" }) }
    );

    await expect(response.json()).resolves.toEqual(result);
    expect(response.status).toBe(200);
    expect(updateAndReapply).toHaveBeenCalledWith("evidence_signal", body);
  });

  it("deletes evidence through the delete route without physically deleting audit history", async () => {
    const deleted = {
      id: "evidence_signal",
      title: "Deleted evidence",
      status: "DELETED",
      links: []
    };
    const deleteEvidence = vi.fn().mockResolvedValue(deleted);
    getWorldModelServices.mockReturnValue({
      evidence: {
        deleteEvidence
      }
    });
    const { DELETE } = await import("@/app/api/evidence/[id]/route");

    const response = await DELETE(new Request("http://localhost/api/evidence/evidence_signal", { method: "DELETE" }), {
      params: Promise.resolve({ id: "evidence_signal" })
    });

    await expect(response.json()).resolves.toEqual(deleted);
    expect(response.status).toBe(200);
    expect(deleteEvidence).toHaveBeenCalledWith("evidence_signal");
  });
});
