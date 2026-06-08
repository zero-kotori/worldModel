import { groupObservationsForReview, observationStatusLabels } from "@/lib/world-model-observations-ui";
import type { ObservationRecord } from "@/server/services/types";

function observation(id: string, status: ObservationRecord["status"]): ObservationRecord {
  return {
    id,
    title: id,
    content: id,
    observedAt: new Date(`2026-06-09T00:0${id.length}:00.000Z`),
    status,
    credibility: 0.5,
    metadata: {}
  };
}

describe("world model observations UI", () => {
  it("separates unknown observations and duplicate candidates for review", () => {
    const grouped = groupObservationsForReview([
      observation("pending", "PENDING"),
      observation("unknown", "UNKNOWN"),
      observation("duplicate", "DUPLICATE"),
      observation("confirmed", "CONFIRMED")
    ]);

    expect(grouped.unknown.map((item) => item.id)).toEqual(["unknown"]);
    expect(grouped.duplicates.map((item) => item.id)).toEqual(["duplicate"]);
    expect(grouped.activePool.map((item) => item.id)).toEqual(["pending"]);
    expect(observationStatusLabels.UNKNOWN).toBe("未知证据");
    expect(observationStatusLabels.DUPLICATE).toBe("重复候选");
  });
});
