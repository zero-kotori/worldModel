import { getLatestSourceRun, runErrorSummary, sourceHealthLabel } from "@/lib/world-model-sources-ui";
import type { ObservationRunRecord, ObservationSourceRecord } from "@/server/services/types";

function source(id: string, enabled = true): ObservationSourceRecord {
  return {
    id,
    name: id,
    kind: "WEB_PAGE",
    adapter: "web_page",
    credibility: 0.7,
    enabled,
    autoConfirm: false,
    autoConfirmThreshold: 0.8,
    createdAt: new Date("2026-06-11T00:00:00.000Z"),
    updatedAt: new Date("2026-06-11T00:00:00.000Z")
  };
}

function run(input: Partial<ObservationRunRecord> & Pick<ObservationRunRecord, "id" | "sourceId" | "status" | "startedAt">): ObservationRunRecord {
  return {
    finishedAt: input.startedAt,
    itemCount: 0,
    deduplicatedCount: 0,
    candidateCount: 0,
    autoAppliedCount: 0,
    reviewCount: 0,
    queryCount: 0,
    querySummary: [],
    ...input
  };
}

describe("world model sources UI", () => {
  it("finds the latest run for one source", () => {
    const latest = run({
      id: "latest",
      sourceId: "source_1",
      status: "FAILED",
      startedAt: new Date("2026-06-11T02:00:00.000Z")
    });

    expect(
      getLatestSourceRun("source_1", [
        run({ id: "other", sourceId: "source_2", status: "SUCCESS", startedAt: new Date("2026-06-11T03:00:00.000Z") }),
        run({ id: "old", sourceId: "source_1", status: "SUCCESS", startedAt: new Date("2026-06-11T01:00:00.000Z") }),
        latest
      ])
    ).toBe(latest);
  });

  it("labels source health from enabled state and latest run", () => {
    expect(sourceHealthLabel(source("disabled", false), undefined)).toBe("已停用");
    expect(sourceHealthLabel(source("never"), undefined)).toBe("未运行");
    expect(
      sourceHealthLabel(
        source("failed"),
        run({
          id: "failed-run",
          sourceId: "failed",
          status: "FAILED",
          startedAt: new Date("2026-06-11T00:00:00.000Z"),
          errorMessage: "fetch failed"
        })
      )
    ).toBe("失败");
    expect(
      sourceHealthLabel(
        source("ok"),
        run({ id: "ok-run", sourceId: "ok", status: "REVIEW_ONLY", startedAt: new Date("2026-06-11T00:00:00.000Z") })
      )
    ).toBe("待审");
  });

  it("truncates long run error messages for table display", () => {
    const message = runErrorSummary(
      run({
        id: "failed-run",
        sourceId: "source_1",
        status: "FAILED",
        startedAt: new Date("2026-06-11T00:00:00.000Z"),
        errorMessage: "x".repeat(180)
      })
    );

    expect(message).toHaveLength(121);
    expect(message.endsWith("...")).toBe(true);
  });
});
