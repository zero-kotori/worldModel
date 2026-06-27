import { vi } from "vitest";

const getWorldModelServices = vi.fn();

vi.mock("@/server/services", () => ({
  getWorldModelServices
}));

describe("observation confirm route", () => {
  beforeEach(() => {
    getWorldModelServices.mockReset();
    process.env.WORLDMODEL_ACCESS_MODE = "standalone";
  });

  it("confirms an observation and applies the resulting evidence update", async () => {
    const result = {
      evidence: {
        id: "evidence_confirmed",
        observationId: "observation_candidate",
        links: [{ hypothesisId: "hypothesis_signal" }]
      },
      event: {
        id: "update_event",
        evidenceId: "evidence_confirmed",
        beliefId: "belief_signal"
      },
      events: [
        {
          id: "update_event",
          evidenceId: "evidence_confirmed",
          beliefId: "belief_signal"
        }
      ]
    };
    const confirmObservation = vi.fn().mockResolvedValue({ id: "evidence_only" });
    const confirmAndApplyObservation = vi.fn().mockResolvedValue(result);
    getWorldModelServices.mockReturnValue({
      evidence: {
        confirmObservation,
        confirmAndApplyObservation
      }
    });
    const { POST } = await import("@/app/api/observations/[id]/confirm/route");
    const body = {
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: "hypothesis_signal",
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 2,
          confidence: 0.7,
          rationale: "Candidate evidence supports the hypothesis."
        }
      ]
    };

    const response = await POST(
      new Request("http://localhost/api/observations/observation_candidate/confirm", {
        method: "POST",
        body: JSON.stringify(body)
      }),
      { params: Promise.resolve({ id: "observation_candidate" }) }
    );

    await expect(response.json()).resolves.toEqual(result);
    expect(response.status).toBe(201);
    expect(confirmAndApplyObservation).toHaveBeenCalledWith({
      ...body,
      observationId: "observation_candidate"
    });
    expect(confirmObservation).not.toHaveBeenCalled();
  });
});
