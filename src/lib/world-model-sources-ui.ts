import type { ObservationRunRecord, ObservationSourceRecord } from "@/server/services/types";

type AutomationHealthTone = "idle" | "healthy" | "warning" | "failing";

export function getLatestSourceRun(sourceId: string, runs: ObservationRunRecord[]) {
  return runs
    .filter((run) => run.sourceId === sourceId)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
}

export function sourceHealthLabel(source: ObservationSourceRecord, latestRun?: ObservationRunRecord) {
  if (!source.enabled) return "已停用";
  if (!latestRun) return "未运行";
  if (latestRun.status === "FAILED") return "失败";
  if (latestRun.status === "REVIEW_ONLY") return "待审";
  if (latestRun.status === "DRY_RUN") return "Dry-run";
  return "正常";
}

export function runErrorSummary(run?: ObservationRunRecord) {
  const message = run?.errorMessage?.trim();
  if (!message) return "";
  return message.length > 120 ? `${message.slice(0, 118)}...` : message;
}

function sortedRuns(runs: ObservationRunRecord[]) {
  return [...runs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

function successfulRun(run: ObservationRunRecord) {
  return run.status !== "FAILED";
}

export function summarizeAutomationHealth(runs: ObservationRunRecord[]): {
  label: string;
  tone: AutomationHealthTone;
  consecutiveFailureCount: number;
  latestRunAt?: Date;
  lastSuccessAt?: Date;
  latestError: string;
  latestCounts: Pick<ObservationRunRecord, "itemCount" | "candidateCount" | "autoAppliedCount" | "reviewCount">;
} {
  const orderedRuns = sortedRuns(runs);
  const latestRun = orderedRuns[0];

  if (!latestRun) {
    return {
      label: "未运行",
      tone: "idle",
      consecutiveFailureCount: 0,
      latestRunAt: undefined,
      lastSuccessAt: undefined,
      latestError: "",
      latestCounts: {
        itemCount: 0,
        candidateCount: 0,
        autoAppliedCount: 0,
        reviewCount: 0
      }
    };
  }

  const consecutiveFailureCount = orderedRuns.findIndex(successfulRun);
  const failureCount = consecutiveFailureCount === -1 ? orderedRuns.length : consecutiveFailureCount;
  const lastSuccess = orderedRuns.find(successfulRun);
  const latestFailedRun = orderedRuns.find((run) => run.status === "FAILED");
  let tone: AutomationHealthTone = "healthy";
  let label = "正常";

  if (failureCount >= 2) {
    tone = "failing";
    label = "连续失败";
  } else if (failureCount === 1) {
    tone = "warning";
    label = "最近失败";
  }

  return {
    label,
    tone,
    consecutiveFailureCount: failureCount,
    latestRunAt: latestRun.startedAt,
    lastSuccessAt: lastSuccess?.startedAt,
    latestError: runErrorSummary(latestFailedRun),
    latestCounts: {
      itemCount: latestRun.itemCount,
      candidateCount: latestRun.candidateCount,
      autoAppliedCount: latestRun.autoAppliedCount,
      reviewCount: latestRun.reviewCount
    }
  };
}
