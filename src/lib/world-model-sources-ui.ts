import type { AutomationHeartbeatRecord, ObservationRunRecord, ObservationSourceRecord } from "@/server/services/types";

type AutomationHealthTone = "idle" | "healthy" | "warning" | "failing";
type AutomationWorkerSummary = {
  id?: string;
  status?: AutomationHeartbeatRecord["status"];
  label: string;
  tone: AutomationHealthTone;
  latestHeartbeatAt?: Date;
  nextRunAt?: Date;
  intervalMs?: number;
  consecutiveFailureCount: number;
  lastError: string;
};

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

function truncateErrorMessage(message: string | undefined) {
  const trimmed = message?.trim();
  if (!trimmed) return "";
  return trimmed.length > 120 ? `${trimmed.slice(0, 118)}...` : trimmed;
}

export function runErrorSummary(run?: ObservationRunRecord) {
  return truncateErrorMessage(run?.errorMessage);
}

function sortedRuns(runs: ObservationRunRecord[]) {
  return [...runs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

function successfulRun(run: ObservationRunRecord) {
  return run.status !== "FAILED";
}

function latestHeartbeat(heartbeats: AutomationHeartbeatRecord[]) {
  return [...heartbeats].sort((a, b) => b.heartbeatAt.getTime() - a.heartbeatAt.getTime())[0];
}

function isHeartbeatStale(heartbeat: AutomationHeartbeatRecord, referenceTime: Date) {
  if (heartbeat.status === "IDLE") return false;
  const graceMs = Math.max(heartbeat.intervalMs * 2, 5 * 60 * 1000);
  const dueAt = heartbeat.nextRunAt ?? new Date(heartbeat.heartbeatAt.getTime() + heartbeat.intervalMs);
  return referenceTime.getTime() > dueAt.getTime() + graceMs;
}

function workerSummaryBase(heartbeat: AutomationHeartbeatRecord): Omit<AutomationWorkerSummary, "label" | "tone"> {
  return {
    id: heartbeat.id,
    status: heartbeat.status,
    latestHeartbeatAt: heartbeat.heartbeatAt,
    nextRunAt: heartbeat.nextRunAt,
    intervalMs: heartbeat.intervalMs,
    consecutiveFailureCount: heartbeat.consecutiveFailureCount,
    lastError: truncateErrorMessage(heartbeat.lastError)
  };
}

function summarizeWorker(heartbeats: AutomationHeartbeatRecord[] = [], referenceTime = new Date()): AutomationWorkerSummary {
  const heartbeat = latestHeartbeat(heartbeats);
  if (!heartbeat) {
    return {
      id: undefined,
      status: undefined,
      label: "未注册",
      tone: "idle",
      latestHeartbeatAt: undefined,
      nextRunAt: undefined,
      intervalMs: undefined,
      consecutiveFailureCount: 0,
      lastError: ""
    };
  }

  if (isHeartbeatStale(heartbeat, referenceTime)) {
    return {
      ...workerSummaryBase(heartbeat),
      label: "心跳过期",
      tone: "failing"
    };
  }

  if (heartbeat.status === "IDLE") {
    return {
      ...workerSummaryBase(heartbeat),
      label: "已停止",
      tone: "idle"
    };
  }

  if (heartbeat.status === "ERROR") {
    return {
      ...workerSummaryBase(heartbeat),
      label: "等待重试",
      tone: heartbeat.consecutiveFailureCount >= 2 ? "failing" : "warning"
    };
  }

  return {
    ...workerSummaryBase(heartbeat),
    label: "运行中",
    tone: "healthy"
  };
}

export function summarizeAutomationHealth(
  runs: ObservationRunRecord[],
  heartbeats: AutomationHeartbeatRecord[] = [],
  referenceTime = new Date()
): {
  label: string;
  tone: AutomationHealthTone;
  consecutiveFailureCount: number;
  latestRunAt?: Date;
  lastSuccessAt?: Date;
  latestError: string;
  latestCounts: Pick<ObservationRunRecord, "itemCount" | "candidateCount" | "autoAppliedCount" | "reviewCount">;
  worker: AutomationWorkerSummary;
} {
  const orderedRuns = sortedRuns(runs);
  const latestRun = orderedRuns[0];
  const worker = summarizeWorker(heartbeats, referenceTime);

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
      },
      worker
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
    },
    worker
  };
}
