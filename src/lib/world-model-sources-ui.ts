import type { AutomationHeartbeatRecord, ObservationRunRecord, ObservationSourceRecord } from "@/server/services/types";

type AutomationHealthTone = "idle" | "healthy" | "warning" | "failing";
const SOURCE_FAILURE_SUPPRESSION_THRESHOLD = 3;

type AutomationDiagnostic = {
  level: "info" | "warning" | "error";
  title: string;
  detail: string;
};
type AutomationNextAction = {
  label: string;
  href: string;
};
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
      sourceCount?: number;
      enabledSourceCount?: number;
      activeBeliefCount?: number;
      activeHypothesisCount?: number;
      effectiveHypothesisCount?: number;
      sources?: ObservationSourceRecord[];
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
type SuppressedAutomationSource = {
  source: ObservationSourceRecord;
  consecutiveFailureCount: number;
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

export function runQuerySummary(run?: ObservationRunRecord) {
  const firstQuery = run?.querySummary[0]?.query.trim();
  if (!firstQuery) return "";
  const summary = firstQuery.length > 80 ? `${firstQuery.slice(0, 78)}...` : firstQuery;
  const remaining = Math.max((run?.querySummary.length ?? 0) - 1, 0);
  return remaining > 0 ? `${summary} +${remaining}` : summary;
}

function sortedRuns(runs: ObservationRunRecord[]) {
  return [...runs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

function sourceConsecutiveFailureCount(sourceId: string, runs: ObservationRunRecord[]) {
  let failureCount = 0;
  for (const run of sortedRuns(runs).filter((item) => item.sourceId === sourceId)) {
    if (run.status !== "FAILED") break;
    failureCount += 1;
  }
  return failureCount;
}

function suppressedAutomationSources(sources: ObservationSourceRecord[], runs: ObservationRunRecord[]): SuppressedAutomationSource[] {
  return sources
    .filter((source) => source.enabled && source.kind !== "MANUAL")
    .map((source) => ({
      source,
      consecutiveFailureCount: sourceConsecutiveFailureCount(source.id, runs)
    }))
    .filter((item) => item.consecutiveFailureCount >= SOURCE_FAILURE_SUPPRESSION_THRESHOLD);
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
    return {
      referenceTime: options,
      workerRuntime: [],
      sourceCount: undefined,
      enabledSourceCount: undefined,
      activeBeliefCount: undefined,
      activeHypothesisCount: undefined,
      effectiveHypothesisCount: undefined,
      sources: []
    };
  }
  return {
    referenceTime: options?.referenceTime ?? new Date(),
    workerRuntime: options?.workerRuntime ?? [],
    sourceCount: options?.sourceCount,
    enabledSourceCount: options?.enabledSourceCount,
    activeBeliefCount: options?.activeBeliefCount,
    activeHypothesisCount: options?.activeHypothesisCount,
    effectiveHypothesisCount: options?.effectiveHypothesisCount,
    sources: options?.sources ?? []
  };
}

function isFetchFailure(message: string) {
  return /fetch failed|failed to fetch|network|timeout|enotfound|econn|etimedout/i.test(message);
}

function automationDiagnostics(input: {
  sourceCount?: number;
  enabledSourceCount?: number;
  activeBeliefCount?: number;
  activeHypothesisCount?: number;
  effectiveHypothesisCount?: number;
  latestRun?: ObservationRunRecord;
  latestFailedRun?: ObservationRunRecord;
  suppressedSources: SuppressedAutomationSource[];
  worker: AutomationWorkerSummary;
}): AutomationDiagnostic[] {
  const diagnostics: AutomationDiagnostic[] = [];

  if (input.sourceCount === 0) {
    diagnostics.push({
      level: "warning",
      title: "缺少采集来源",
      detail: "添加或补齐推荐来源后，闭环才能自动搜集观察。"
    });
  } else if (input.enabledSourceCount === 0) {
    diagnostics.push({
      level: "warning",
      title: "没有启用来源",
      detail: "启用至少一个非手动来源后，闭环才能自动采集。"
    });
  }

  if (input.activeBeliefCount === 0) {
    diagnostics.push({
      level: "warning",
      title: "缺少活跃信念",
      detail: "创建至少一个活跃信念表后，闭环才能生成检索任务。"
    });
  } else if (input.activeHypothesisCount === 0) {
    diagnostics.push({
      level: "warning",
      title: "缺少活跃假设",
      detail: "为活跃信念表添加假设后，闭环才能评估证据并更新概率。"
    });
  } else if (input.effectiveHypothesisCount === 0) {
    diagnostics.push({
      level: "warning",
      title: "没有当前有效假设",
      detail: "活跃假设尚未开始或已经过期，续期、归档或补充当前可检验假设后，闭环才能生成有效检索任务。"
    });
  }

  if (input.suppressedSources.length > 0) {
    const names = input.suppressedSources
      .slice(0, 3)
      .map((item) => item.source.name)
      .join("、");
    const remaining = input.suppressedSources.length > 3 ? ` 等 ${input.suppressedSources.length} 个来源` : "";
    diagnostics.push({
      level: "warning",
      title: "来源已自动降噪",
      detail: `${names}${remaining} 已连续失败至少 ${SOURCE_FAILURE_SUPPRESSION_THRESHOLD} 次，自动闭环会暂时跳过；手动运行来源可验证恢复。`
    });
  }

  const failureMessage = input.latestFailedRun?.errorMessage?.trim() ?? "";
  if (input.latestFailedRun && isFetchFailure(failureMessage)) {
    diagnostics.push({
      level: "error",
      title: "来源抓取失败",
      detail: "检查最近失败来源的 URL、网络可达性或适配器配置。"
    });
  }

  if (
    input.latestRun &&
    input.latestRun.status !== "FAILED" &&
    input.latestRun.candidateCount > 0 &&
    input.latestRun.autoAppliedCount === 0 &&
    input.latestRun.reviewCount > 0
  ) {
    diagnostics.push({
      level: "info",
      title: "候选等待确认",
      detail: "关闭仅生成待审或降低自动应用阈值后，可信候选才能自动更新信念。"
    });
  }

  if (
    input.latestRun &&
    input.latestRun.status !== "FAILED" &&
    input.latestRun.queryCount > 0 &&
    input.latestRun.itemCount === 0
  ) {
    diagnostics.push({
      level: "info",
      title: "未采集观察",
      detail: "最近运行生成了检索任务，但来源没有返回可入库观察。"
    });
  }

  if (
    input.latestRun &&
    input.latestRun.status !== "FAILED" &&
    input.latestRun.queryCount > 0 &&
    input.latestRun.itemCount > 0 &&
    input.latestRun.candidateCount === 0
  ) {
    diagnostics.push({
      level: "info",
      title: "未识别候选证据",
      detail: "收窄假设表述、调整来源或降低候选识别阈值。"
    });
  }

  if (input.worker.label === "心跳过期") {
    diagnostics.push({
      level: "error",
      title: "守护进程心跳过期",
      detail: "重新启动守护进程，或检查本地服务进程是否仍在运行。"
    });
  }

  return diagnostics;
}

function addNextAction(actions: AutomationNextAction[], action: AutomationNextAction) {
  if (!actions.some((item) => item.href === action.href && item.label === action.label)) {
    actions.push(action);
  }
}

function automationNextActions(diagnostics: AutomationDiagnostic[]): AutomationNextAction[] {
  const actions: AutomationNextAction[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.title === "缺少采集来源" || diagnostic.title === "没有启用来源") {
      addNextAction(actions, {
        label: "添加推荐来源",
        href: "/admin/world-model/sources#recommended-sources"
      });
    }
    if (diagnostic.title === "缺少活跃信念") {
      addNextAction(actions, {
        label: "创建信念表",
        href: "/admin/world-model/beliefs"
      });
    }
    if (diagnostic.title === "缺少活跃假设") {
      addNextAction(actions, {
        label: "补充假设",
        href: "/admin/world-model/beliefs"
      });
    }
    if (diagnostic.title === "来源抓取失败") {
      addNextAction(actions, {
        label: "检查来源配置",
        href: "/admin/world-model/sources#source-list"
      });
    }
    if (diagnostic.title === "来源已自动降噪") {
      addNextAction(actions, {
        label: "检查来源配置",
        href: "/admin/world-model/sources#source-list"
      });
    }
    if (diagnostic.title === "候选等待确认") {
      addNextAction(actions, {
        label: "处理待审候选",
        href: "/admin/world-model/observations"
      });
    }
    if (diagnostic.title === "未识别候选证据") {
      addNextAction(actions, {
        label: "调整信念假设",
        href: "/admin/world-model/beliefs"
      });
    }
    if (diagnostic.title === "没有当前有效假设") {
      addNextAction(actions, {
        label: "调整信念假设",
        href: "/admin/world-model/beliefs"
      });
    }
    if (diagnostic.title === "未采集观察") {
      addNextAction(actions, {
        label: "调整采集来源",
        href: "/admin/world-model/sources#source-list"
      });
    }
    if (diagnostic.title === "守护进程心跳过期") {
      addNextAction(actions, {
        label: "检查守护进程",
        href: "/admin/world-model/sources#automation-worker"
      });
    }
  }
  return actions;
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
  diagnostics: AutomationDiagnostic[];
  nextActions: AutomationNextAction[];
} {
  const {
    referenceTime,
    workerRuntime,
    sourceCount,
    enabledSourceCount,
    activeBeliefCount,
    activeHypothesisCount,
    effectiveHypothesisCount,
    sources
  } = normalizeHealthOptions(options);
  const orderedRuns = sortedRuns(runs);
  const latestRun = orderedRuns[0];
  const worker = summarizeWorker(heartbeats, referenceTime, workerRuntime);
  const latestFailedRun = orderedRuns.find((run) => run.status === "FAILED");
  const suppressedSources = suppressedAutomationSources(sources, orderedRuns);
  const diagnostics = automationDiagnostics({
    sourceCount,
    enabledSourceCount,
    activeBeliefCount,
    activeHypothesisCount,
    effectiveHypothesisCount,
    latestRun,
    latestFailedRun,
    suppressedSources,
    worker
  });
  const nextActions = automationNextActions(diagnostics);

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
      worker,
      diagnostics,
      nextActions
    };
  }

  const consecutiveFailureCount = orderedRuns.findIndex(successfulRun);
  const failureCount = consecutiveFailureCount === -1 ? orderedRuns.length : consecutiveFailureCount;
  const lastSuccess = orderedRuns.find(successfulRun);
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
    worker,
    diagnostics,
    nextActions
  };
}
