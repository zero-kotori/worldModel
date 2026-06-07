import { applyUpdate, createUpdatePreview, rollbackUpdate } from "@/domain/updates";

describe("update previews and rollback", () => {
  it("creates an independent update preview with before and after snapshots", () => {
    const preview = createUpdatePreview(
      {
        id: "belief-1",
        probabilityMode: "INDEPENDENT",
        hypotheses: [
          { id: "h1", proposition: "AI agents become mainstream", currentProbability: 0.4, strength: 0.4 },
          { id: "h2", proposition: "Adoption stalls", currentProbability: 0.3, strength: 0.3 }
        ]
      },
      [{ hypothesisId: "h1", likelihoodRatio: 2, credibility: 0.8, confidence: 0.7, rationale: "new adoption signal" }]
    );

    expect(preview.priorSnapshot).toEqual({ h1: 0.4, h2: 0.3 });
    expect(preview.posteriorSnapshot.h1).toBeGreaterThan(0.4);
    expect(preview.posteriorSnapshot.h2).toBe(0.3);
    expect(preview.explanations[0]).toContain("new adoption signal");
  });

  it("creates mutually exclusive previews whose posterior sums to one", () => {
    const preview = createUpdatePreview(
      {
        id: "belief-1",
        probabilityMode: "MUTUALLY_EXCLUSIVE",
        hypotheses: [
          { id: "h1", proposition: "Scenario A", currentProbability: 0.6, strength: 0.6 },
          { id: "h2", proposition: "Scenario B", currentProbability: 0.4, strength: 0.4 }
        ]
      },
      [
        { hypothesisId: "h1", likelihoodRatio: 0.5, credibility: 1, confidence: 0.8, rationale: "weakens A" },
        { hypothesisId: "h2", likelihoodRatio: 2, credibility: 1, confidence: 0.8, rationale: "supports B" }
      ]
    );

    const total = Object.values(preview.posteriorSnapshot).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1, 8);
    expect(preview.posteriorSnapshot.h2).toBeGreaterThan(0.4);
  });

  it("applies and rolls back an update event to the prior snapshot", () => {
    const preview = createUpdatePreview(
      {
        id: "belief-1",
        probabilityMode: "INDEPENDENT",
        hypotheses: [{ id: "h1", proposition: "AI trend", currentProbability: 0.4, strength: 0.4 }]
      },
      [{ hypothesisId: "h1", likelihoodRatio: 2, credibility: 1, confidence: 0.8, rationale: "supporting evidence" }]
    );
    const event = applyUpdate(preview, { id: "event-1", createdAt: new Date("2026-06-07T09:00:00.000Z") });
    const rollback = rollbackUpdate(event, new Date("2026-06-07T10:00:00.000Z"));

    expect(event.status).toBe("APPLIED");
    expect(rollback.status).toBe("ROLLED_BACK");
    expect(rollback.restoredProbabilities).toEqual({ h1: 0.4 });
    expect(rollback.rolledBackAt?.toISOString()).toBe("2026-06-07T10:00:00.000Z");
  });
});
