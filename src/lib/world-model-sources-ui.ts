import type { AutomationHeartbeatRecord, ObservationRunRecord, ObservationSourceRecord } from "@/server/services/types";

type AutomationHealthTone = "idle" | "healthy" | "warning" | "failing";
type AutomationWorkerRuntime = {
  workerId: string;
  running: boolean;
  nextRunAt?: Date;
  consecutiveFailureCount: number;
};
type AutomationHealthOptions =
  | Date
  | {
      referenceTime?: Date;
      workerRuntime?: AutomationWorkerRuntime[];
    };
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
  const ordered = [...heartbeats].sort((a, b) => b.heartbeatAt.getTime() - a.heartbeatAt.getTime());
  return ordered.find((heartbeat) => heartbeat.status !== "IDLE") ?? ordered[0];
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

function latestHeartbeatForWorker(heartbeats: AutomationHeartbeatRecord[], workerId: string) {
  return latestHeartbeat(heartbeats.filter((heartbeat) => heartbeat.id === workerId));
}

function summarizeRuntimeWorker(
  runtime: AutomationWorkerRuntime[] = [],
  heartbeats: AutomationHeartbeatRecord[] = []
): AutomationWorkerSummary | undefined {
  const worker = runtime.find((item) => item.running);
  if (!worker) return undefined;
  const heartbeat = latestHeartbeatForWorker(heartbeats, worker.workerId);
  const hasFailures = worker.consecutiveFailureCount > 0 || heartbeat?.status === "ERROR";
  return {
    id: worker.workerId,
    status: hasFailures ? "ERROR" : "RUNNING",
    label: hasFailures ? "等待重试" : "运行中",
    tone: hasFailures ? (worker.consecutiveFailureCount >= 2 ? "failing" : "warning") : "healthy",
    latestHeartbeatAt: heartbeat?.heartbeatAt,
    nextRunAt: worker.nextRunAt ?? heartbeat?.nextRunAt,
    intervalMs: heartbeat?.intervalMs,
    consecutiveFailureCount: worker.consecutiveFailureCount,
    lastError: truncateErrorMessage(heartbeat?.lastError)
  };
}

function summarizeWorker(
  heartbeats: AutomationHeartbeatRecord[] = [],
  referenceTime = new Date(),
  runtime: AutomationWorkerRuntime[] = []
): AutomationWorkerSummary {
  const runtimeSummary = summarizeRuntimeWorker(runtime, heartbeats);
  if (runtimeSummary) return runtimeSummary;

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

function normalizeHealthOptions(options: AutomationHealthOptions | undefined) {
  if (options instanceof Date) {
    return { referenceTime: options, workerRuntime: [] };
  }
  return {
    referenceTime: options?.referenceTime ?? new Date(),
    workerRuntime: options?.workerRuntime ?? []
  };
}

export function summarizeAutomationHealth(
  runs: ObservationRunRecord[],
  heartbeats: AutomationHeartbeatRecord[] = [],
  options?: AutomationHealthOptions
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
  const { referenceTime, workerRuntime } = normalizeHealthOptions(options);
  const orderedRuns = sortedRuns(runs);
  const latestRun = orderedRuns[0];
  const worker = summarizeWorker(heartbeats, referenceTime, workerRuntime);

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
