import { deduplicateObservation } from "@/domain/dedupe";

const observedAt = new Date("2026-06-07T08:00:00.000Z");

describe("observation deduplication", () => {
  it("detects exact URL duplicates first", () => {
    const decision = deduplicateObservation(
      { title: "A", content: "Alpha", url: "https://example.com/a", observedAt },
      [{ id: "existing-url", title: "A old", content: "Alpha old", url: "https://example.com/a", observedAt }]
    );

    expect(decision).toEqual({
      duplicate: true,
      reason: "URL",
      duplicateOfId: "existing-url",
      confidence: 1
    });
  });

  it("detects normalized content hash duplicates", () => {
    const decision = deduplicateObservation(
      { title: "A", content: "OpenAI releases a model.", normalizedHash: "hash-1", observedAt },
      [{ id: "existing-hash", title: "B", content: "Same", normalizedHash: "hash-1", observedAt }]
    );

    expect(decision.reason).toBe("HASH");
    expect(decision.duplicateOfId).toBe("existing-hash");
  });

  it("detects semantic duplicates within the configured time window", () => {
    const decision = deduplicateObservation(
      { title: "A", content: "AI trend", semanticKey: "ai-trend", observedAt },
      [
        {
          id: "existing-semantic",
          title: "B",
          content: "AI trend old",
          semanticKey: "ai-trend",
          observedAt: new Date("2026-06-07T06:00:00.000Z")
        }
      ],
      { semanticWindowHours: 6 }
    );

    expect(decision.reason).toBe("SEMANTIC");
    expect(decision.confidence).toBeLessThan(1);
  });

  it("keeps unrelated observations pending", () => {
    const decision = deduplicateObservation(
      { title: "A", content: "AI trend", semanticKey: "ai-trend", observedAt },
      [{ id: "other", title: "B", content: "Markets", semanticKey: "market", observedAt }]
    );

    expect(decision).toEqual({ duplicate: false, reason: "NONE", confidence: 0 });
  });
});
