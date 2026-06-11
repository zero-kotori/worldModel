import type { ObservationRunRecord, ObservationSourceRecord } from "@/server/services/types";

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
