import {
  getObservationRecommendedLinks,
  groupObservationsForReview,
  observationReviewPriority,
  observationReviewPriorityLabel
} from "@/lib/world-model-observations-ui";
import type {
  AutomationHeartbeatRecord,
  BayesianUpdateEventRecord,
  BeliefRecord,
  EvidenceRecord,
  EvidenceLoopResult,
  ObservationRecord,
  ObservationRunRecord,
  ObservationSourceRecord
} from "@/server/services/types";
import { isHypothesisCurrentlyEffective } from "@/lib/world-model-beliefs-ui";
import type { LlmEvaluationArtifact } from "@/server/training/llm-evaluation-artifact";

type AutomationHealthTone = "idle" | "healthy" | "warning" | "failing";
const SOURCE_FAILURE_SUPPRESSION_THRESHOLD = 3;
const SOURCE_DUPLICATE_STALENESS_THRESHOLD = 3;
const SOURCE_FAILURE_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const SOURCE_DUPLICATE_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MIN_LLM_EVALUATION_SAMPLE_COUNT = 20;
const LLM_EVALUATION_MAX_AGE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const LLM_EVALUATION_REVIEW_RATE_THRESHOLD = 0.3;
const LLM_EVALUATION_FALLBACK_DIVERGENCE_RATE_THRESHOLD = 0.3;
const LLM_EVALUATION_DIRECTION_ACCURACY_WARNING_THRESHOLD = 0.7;
const SOURCE_AUTO_APPLY_RISK_MIN_EVIDENCE = 2;
const SOURCE_AUTO_APPLY_RISK_PROBLEM_RATE_THRESHOLD = 0.5;
const SOURCE_EVIDENCE_CREDIBILITY_TARGET_WEIGHT = 0.7;
const SOURCE_EVIDENCE_AUTO_CONFIRM_BASE_THRESHOLD = 0.85;
const SOURCE_EVIDENCE_AUTO_CONFIRM_THRESHOLD_STEP = 0.1;

type AutomationDiagnostic = {
  level: "info" | "warning" | "error";
  title: string;
  detail: string;
};
type AutomationNextAction = {
  label: string;
  href: string;
};
type LlmEvaluationDiagnosticsOptions = Date | { referenceTime?: Date };
type SourceRunFollowupAction = {
  label: string;
  href: string;
};
type SourceRunFollowupOptions = {
  observations?: ObservationRecord[];
  observationCode?: (observation: ObservationRecord) => string;
};
type AutomationAttentionItem = {
  key: string;
  label: string;
  code: string;
  title: string;
  detail: string;
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
      openObservationCount?: number;
      duplicateObservationCount?: number;
      llmScorerReady?: boolean;
      llmEvaluation?: LlmEvaluationArtifact | null;
      sources?: ObservationSourceRecord[];
      observations?: ObservationRecord[];
      evidence?: EvidenceRecord[];
      updates?: BayesianUpdateEventRecord[];
      beliefs?: BeliefRecord[];
      latestUnmatchedObservationCode?: string;
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
  lastNotice: string;
  lastError: string;
};
type SuppressedAutomationSource = {
  source: ObservationSourceRecord;
  consecutiveFailureCount: number;
  latestFailureAt: Date;
  retryAfterAt: Date;
};
type StaleDuplicateSource = {
  source: ObservationSourceRecord;
  consecutiveDuplicateOnlyCount: number;
  latestDuplicateOnlyAt: Date;
  retryAfterAt: Date;
};
export type LowQualitySource = {
  source: ObservationSourceRecord;
  quality: SourceEvidenceQualitySummary;
  adjustment?: SourceEvidenceQualityAdjustment;
};
type SourceEvidenceQualityInput = {
  observations: ObservationRecord[];
  evidence: EvidenceRecord[];
  updates: BayesianUpdateEventRecord[];
};
export type SourceEvidenceQualitySummary = {
  sourceId: string;
  evidenceCount: number;
  problemEvidenceCount: number;
  rejectedEvidenceCount: number;
  rolledBackUpdateCount: number;
  problemRate: number;
  tone: "empty" | "healthy" | "warning";
  detail: string;
};
export type SourceEvidenceQualityAdjustment = {
  suggestedCredibility: number;
  suggestedAutoConfirmThreshold: number;
  actionable: boolean;
  detail: string;
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
  if (isDuplicateOnlyRun(latestRun)) return "无新信息";
  return "正常";
}

export function summarizeSourceEvidenceQuality(
  sourceId: string,
  input: SourceEvidenceQualityInput
): SourceEvidenceQualitySummary {
  const observationById = new Map(input.observations.map((observation) => [observation.id, observation]));
  const sourceEvidence = input.evidence.filter((item) => observationById.get(item.observationId)?.sourceId === sourceId);
  const sourceEvidenceIds = new Set(sourceEvidence.map((item) => item.id));
  const rejectedEvidenceIds = new Set(
    sourceEvidence.filter((item) => item.status === "REJECTED" || item.status === "DELETED").map((item) => item.id)
  );
  const rolledBackUpdates = input.updates.filter((event) => event.status === "ROLLED_BACK" && sourceEvidenceIds.has(event.evidenceId));
  const rolledBackEvidenceIds = new Set(rolledBackUpdates.map((event) => event.evidenceId));
  const problemEvidenceIds = new Set([...rejectedEvidenceIds, ...rolledBackEvidenceIds]);
  const evidenceCount = sourceEvidence.length;
  const problemRate = evidenceCount > 0 ? problemEvidenceIds.size / evidenceCount : 0;

  if (evidenceCount === 0) {
    return {
      sourceId,
      evidenceCount,
      problemEvidenceCount: 0,
      rejectedEvidenceCount: 0,
      rolledBackUpdateCount: 0,
      problemRate: 0,
      tone: "empty",
      detail: "暂无证据质量样本。"
    };
  }

  if (problemEvidenceIds.size === 0) {
    return {
      sourceId,
      evidenceCount,
      problemEvidenceCount: 0,
      rejectedEvidenceCount: 0,
      rolledBackUpdateCount: 0,
      problemRate: 0,
      tone: "healthy",
      detail: `证据质量：${evidenceCount} 条证据未出现拒绝或回滚。`
    };
  }

  return {
    sourceId,
    evidenceCount,
    problemEvidenceCount: problemEvidenceIds.size,
    rejectedEvidenceCount: rejectedEvidenceIds.size,
    rolledBackUpdateCount: rolledBackUpdates.length,
    problemRate,
    tone: "warning",
    detail: `证据质量警告：${problemEvidenceIds.size}/${evidenceCount} 条证据出现拒绝或回滚（${formatPercentage(
      problemRate
    )}，回滚 ${rolledBackUpdates.length}，拒绝 ${rejectedEvidenceIds.size}）；建议提高自动确认阈值或暂时停用。`
  };
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
  const first = run?.querySummary[0];
  const firstQuery = first?.query.trim();
  if (!firstQuery) return "";
  const summary = firstQuery.length > 80 ? `${firstQuery.slice(0, 78)}...` : firstQuery;
  const priorityReason = first?.priorityReason?.trim();
  const summaryWithReason = priorityReason ? `${summary} · ${priorityReason}` : summary;
  const remaining = Math.max((run?.querySummary.length ?? 0) - 1, 0);
  return remaining > 0 ? `${summaryWithReason} +${remaining}` : summaryWithReason;
}

function skippedSourceSummary(result: Pick<EvidenceLoopResult, "skippedSourceCount" | "skippedSources">) {
  if (result.skippedSourceCount <= 0) return "";
  if (result.skippedSources.length === 0) return `跳过来源 ${result.skippedSourceCount}`;
  const failedSources = result.skippedSources.filter((source) => source.reason === "CONSECUTIVE_FAILURES");
  const lowIncrementSources = result.skippedSources.filter((source) => source.reason === "LOW_INCREMENT");
  const failureCount = failedSources.length;
  const lowIncrementCount = lowIncrementSources.length;
  const classifiedCount = failureCount + lowIncrementCount;
  const otherCount = Math.max(result.skippedSourceCount - classifiedCount, 0);
  const reasons = [
    ...(failureCount > 0 ? [skippedReasonSummary("连续失败", failedSources)] : []),
    ...(lowIncrementCount > 0 ? [skippedReasonSummary("低增量", lowIncrementSources)] : []),
    ...(otherCount > 0 ? [`其他 ${otherCount}`] : [])
  ];
  return reasons.length > 0 ? `跳过来源 ${result.skippedSourceCount}（${reasons.join("，")}）` : `跳过来源 ${result.skippedSourceCount}`;
}

function skippedReasonSummary(label: string, sources: EvidenceLoopResult["skippedSources"]) {
  const names = sources.map((source) => source.sourceName.trim()).filter(Boolean);
  const retryAfterSummary = retryAfterAtSummary(sources);
  if (names.length === 0) return `${label} ${sources.length}${retryAfterSummary}`;
  const displayed = names.slice(0, 2).join("、");
  const suffix = names.length > 2 ? ` 等 ${names.length} 个` : "";
  return `${label} ${sources.length}：${displayed}${suffix}${retryAfterSummary}`;
}

function retryAfterAtSummary(sources: EvidenceLoopResult["skippedSources"]) {
  const retryAfter = sources
    .map((source) => parseRetryAfterAt(source.retryAfterAt))
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return retryAfter ? ` · 预计重试 ${formatRetryAfterAt(retryAfter)}` : "";
}

function parseRetryAfterAt(value: Date | string | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatRetryAfterAt(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatPercentage(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function roundCalibrationValue(value: number) {
  return Math.round(value * 100) / 100;
}

function clampCalibrationValue(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

function formatCalibrationValue(value: number) {
  return value.toFixed(2);
}

export function recommendSourceEvidenceQualityAdjustment(
  source: Partial<Pick<ObservationSourceRecord, "credibility" | "autoConfirmThreshold">>,
  quality: SourceEvidenceQualitySummary
): SourceEvidenceQualityAdjustment | null {
  if (quality.evidenceCount < SOURCE_AUTO_APPLY_RISK_MIN_EVIDENCE || quality.problemEvidenceCount === 0) return null;

  const credibility = roundCalibrationValue(clampCalibrationValue(typeof source.credibility === "number" ? source.credibility : 0.5));
  const autoConfirmThreshold = roundCalibrationValue(
    clampCalibrationValue(typeof source.autoConfirmThreshold === "number" ? source.autoConfirmThreshold : 0.85)
  );
  const targetCredibility = roundCalibrationValue(
    clampCalibrationValue(1 - quality.problemRate * SOURCE_EVIDENCE_CREDIBILITY_TARGET_WEIGHT)
  );
  const targetAutoConfirmThreshold = roundCalibrationValue(
    clampCalibrationValue(SOURCE_EVIDENCE_AUTO_CONFIRM_BASE_THRESHOLD + quality.problemRate * SOURCE_EVIDENCE_AUTO_CONFIRM_THRESHOLD_STEP)
  );
  const suggestedCredibility = Math.min(credibility, targetCredibility);
  const suggestedAutoConfirmThreshold = roundCalibrationValue(
    clampCalibrationValue(Math.max(autoConfirmThreshold, targetAutoConfirmThreshold))
  );
  const shouldLowerCredibility = suggestedCredibility < credibility;
  const shouldRaiseAutoConfirmThreshold = suggestedAutoConfirmThreshold > autoConfirmThreshold;

  if (!shouldLowerCredibility && !shouldRaiseAutoConfirmThreshold) {
    return {
      suggestedCredibility,
      suggestedAutoConfirmThreshold,
      actionable: false,
      detail: `来源已达到当前证据质量建议：可信度不高于 ${formatCalibrationValue(
        targetCredibility
      )}，自动确认阈值不低于 ${formatCalibrationValue(targetAutoConfirmThreshold)}。`
    };
  }

  const detailParts = [
    ...(shouldLowerCredibility
      ? [`将来源可信度从 ${formatCalibrationValue(credibility)} 降到 ${formatCalibrationValue(suggestedCredibility)}`]
      : []),
    ...(shouldRaiseAutoConfirmThreshold
      ? [
          `将自动确认阈值从 ${formatCalibrationValue(autoConfirmThreshold)} 提高到 ${formatCalibrationValue(
            suggestedAutoConfirmThreshold
          )}`
        ]
      : [])
  ];

  return {
    suggestedCredibility,
    suggestedAutoConfirmThreshold,
    actionable: true,
    detail: `建议${detailParts.join("，并")}。`
  };
}

export function automationLoopSuccessMessage(result: EvidenceLoopResult) {
  const modeLabel = result.mode === "auto-apply" ? "自动应用模式" : "待审模式";
  const parts = [
    `自动证据闭环已运行：${modeLabel}`,
    `查询 ${result.queryCount}`,
    `来源 ${result.sourceRunCount}`,
    `采集 ${result.itemCount}`,
    ...(result.reprocessedObservationCount > 0 ? [`重试旧观察 ${result.reprocessedObservationCount}`] : []),
    ...(result.deduplicatedCount > 0 ? [`去重 ${result.deduplicatedCount}`] : []),
    `候选 ${result.candidateCount}`,
    `自动应用 ${result.autoAppliedCount}`,
    `待审 ${result.reviewCount}`,
    `低影响 ${result.lowImpactCount}`,
    `未匹配 ${result.unmatchedCount}`
  ];
  const skippedSummary = skippedSourceSummary(result);
  if (skippedSummary) parts.push(skippedSummary);
  parts.push(`失败 ${result.failureCount}`);
  return parts.join("，");
}

function latestLoopFailureReason(result: EvidenceLoopResult) {
  const failedRun = [...result.runs]
    .filter((run) => run.status === "FAILED")
    .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())[0];
  return runErrorSummary(failedRun);
}

export function automationLoopActionNotice(result: EvidenceLoopResult) {
  const followups = [
    ...(result.reviewCount > 0 ? [`${result.reviewCount} 条待审候选需要确认`] : []),
    ...(result.lowImpactCount > 0 ? [`${result.lowImpactCount} 条低影响观察需要人工确认、调整关系或拒绝`] : []),
    ...(result.unmatchedCount > 0 ? [`${result.unmatchedCount} 条未匹配观察需要补充假设`] : [])
  ];
  const message = automationLoopSuccessMessage(result);
  const failureReason = latestLoopFailureReason(result);
  const failureNotice = failureReason ? `；失败原因：${failureReason}` : "";
  return followups.length > 0 ? `${message}${failureNotice}；仍需处理：${followups.join("；")}` : `${message}${failureNotice}`;
}

export function automationLoopDryRunActionNotice(result: {
  runs: Array<Pick<ObservationRunRecord, "status" | "itemCount" | "deduplicatedCount" | "queryCount">>;
}) {
  const queryCount = result.runs.reduce((sum, run) => sum + run.queryCount, 0);
  const itemCount = result.runs.reduce((sum, run) => sum + run.itemCount, 0);
  const deduplicatedCount = result.runs.reduce((sum, run) => sum + run.deduplicatedCount, 0);
  const failureCount = result.runs.filter((run) => run.status === "FAILED").length;
  return `闭环预检已运行：来源 ${result.runs.length}，查询 ${queryCount}，采集 ${itemCount}，去重 ${deduplicatedCount}，失败 ${failureCount}`;
}

function newestUnmatchedObservation(run: ObservationRunRecord, observations: ObservationRecord[] = []) {
  const unmatched = observations
    .filter((observation) => observation.status === "UNKNOWN" && observation.metadata.ignoredReason === "UNMATCHED")
    .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
  if (!run.sourceId) return unmatched[0];
  return unmatched.find((observation) => observation.sourceId === run.sourceId) ?? unmatched[0];
}

function unmatchedObservationRecommendationHref(run: ObservationRunRecord, options: SourceRunFollowupOptions = {}) {
  const observation = newestUnmatchedObservation(run, options.observations);
  if (!observation) return "/admin/world-model/beliefs";
  const code = options.observationCode?.(observation) ?? observation.id;
  return `/admin/world-model/beliefs?sourceObservation=${encodeURIComponent(code)}#recommendations`;
}

export function runFollowupActions(run: ObservationRunRecord, options: SourceRunFollowupOptions = {}): SourceRunFollowupAction[] {
  const actions: SourceRunFollowupAction[] = [];
  if (run.status === "FAILED") {
    actions.push({ label: "检查来源", href: "/admin/world-model/sources#source-list" });
    return actions;
  }
  if (isDuplicateOnlyRun(run)) {
    actions.push({ label: "调整来源", href: "/admin/world-model/sources#source-list" });
  }
  if (run.reviewCount > 0) {
    actions.push({ label: "处理待审", href: "/admin/world-model/observations#review-candidates" });
  }
  if (run.lowImpactCount > 0) {
    actions.push({ label: "查看低影响", href: "/admin/world-model/observations#unknown-evidence" });
  }
  if (run.unmatchedCount > 0) {
    actions.push({ label: "补充假设", href: unmatchedObservationRecommendationHref(run, options) });
  }
  return actions;
}

export function automationAttentionItems(
  observations: ObservationRecord[],
  options: {
    limit?: number;
    observationCode?: (observation: ObservationRecord) => string;
  } = {}
): AutomationAttentionItem[] {
  const limit = Math.max(0, options.limit ?? 3);
  if (limit === 0) return [];

  const observationCode = options.observationCode ?? ((observation: ObservationRecord) => observation.id);
  const grouped = groupObservationsForReview(observations);
  const items: AutomationAttentionItem[] = [];

  function add(observation: ObservationRecord, label: string, detail: string, hrefForCode: (code: string) => string) {
    if (items.length >= limit) return;
    const code = observationCode(observation);
    items.push({
      key: observation.id,
      label,
      code,
      title: observation.title,
      detail,
      href: hrefForCode(code)
    });
  }

  for (const observation of grouped.reviewCandidates) {
    const links = getObservationRecommendedLinks(observation);
    add(
      observation,
      "待审候选",
      `${links.length} 个推荐关联 · ${observationReviewPriorityLabel(observationReviewPriority(observation))}`,
      () => "/admin/world-model/observations#review-candidates"
    );
  }

  for (const observation of grouped.duplicates) {
    const duplicateOfCode = observation.duplicateOfId ? observationCode({ ...observation, id: observation.duplicateOfId }) : "";
    add(
      observation,
      "重复候选",
      duplicateOfCode ? `可能重复于 ${duplicateOfCode}，需要核对后拒绝或调整来源。` : "需要核对后拒绝或调整来源。",
      () => "/admin/world-model/observations#duplicate-candidates"
    );
  }

  for (const observation of grouped.unknown) {
    if (observation.metadata.ignoredReason === "LOW_IMPACT") {
      add(
        observation,
        "低影响观察",
        "相关但预期概率变化较小，可人工确认、调整关系或拒绝。",
        () => "/admin/world-model/observations#unknown-evidence"
      );
    } else if (observation.metadata.ignoredReason === "UNMATCHED") {
      add(
        observation,
        "未匹配观察",
        "没有匹配到当前假设，可基于该观察补充假设。",
        (code) => `/admin/world-model/beliefs?sourceObservation=${encodeURIComponent(code)}#recommendations`
      );
    } else {
      add(observation, "未知观察", "需要人工判断是否转为证据。", () => "/admin/world-model/observations#unknown-evidence");
    }
  }

  for (const observation of grouped.activePool) {
    add(
      observation,
      "待处理观察",
      `可信度 ${observation.credibility.toFixed(2)}，需要确认、补充关联或拒绝。`,
      (code) => `/admin/world-model/evidence?observation=${encodeURIComponent(code)}#confirm-observation`
    );
  }

  return items;
}

function isDuplicateOnlyRun(run: ObservationRunRecord) {
  return (
    run.status !== "FAILED" &&
    run.itemCount > 0 &&
    run.deduplicatedCount >= run.itemCount &&
    run.candidateCount === 0 &&
    run.reviewCount === 0 &&
    run.lowImpactCount === 0 &&
    run.unmatchedCount === 0
  );
}

function sortedRuns(runs: ObservationRunRecord[]) {
  return [...runs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

function sourceConsecutiveFailureSummary(sourceId: string, runs: ObservationRunRecord[]) {
  let failureCount = 0;
  let latestFailureAt: Date | undefined;
  for (const run of sortedRuns(runs).filter((item) => item.sourceId === sourceId)) {
    if (run.status !== "FAILED") break;
    latestFailureAt ??= run.startedAt;
    failureCount += 1;
  }
  return { consecutiveFailureCount: failureCount, latestFailureAt };
}

function suppressedAutomationSources(
  sources: ObservationSourceRecord[],
  runs: ObservationRunRecord[],
  referenceTime: Date
): SuppressedAutomationSource[] {
  return sources
    .filter((source) => source.enabled && source.kind !== "MANUAL")
    .flatMap((source) => {
      const summary = sourceConsecutiveFailureSummary(source.id, runs);
      if (summary.consecutiveFailureCount < SOURCE_FAILURE_SUPPRESSION_THRESHOLD || !summary.latestFailureAt) return [];
      const retryAfterAt = new Date(summary.latestFailureAt.getTime() + SOURCE_FAILURE_RETRY_COOLDOWN_MS);
      if (referenceTime.getTime() >= retryAfterAt.getTime()) return [];
      return [
        {
          source,
          consecutiveFailureCount: summary.consecutiveFailureCount,
          latestFailureAt: summary.latestFailureAt,
          retryAfterAt
        }
      ];
    });
}

function sourceConsecutiveDuplicateOnlySummary(sourceId: string, runs: ObservationRunRecord[]) {
  let duplicateOnlyCount = 0;
  let latestDuplicateOnlyAt: Date | undefined;
  for (const run of sortedRuns(runs).filter((item) => item.sourceId === sourceId)) {
    if (!isDuplicateOnlyRun(run)) break;
    latestDuplicateOnlyAt ??= run.startedAt;
    duplicateOnlyCount += 1;
  }
  return { consecutiveDuplicateOnlyCount: duplicateOnlyCount, latestDuplicateOnlyAt };
}

function staleDuplicateSources(
  sources: ObservationSourceRecord[],
  runs: ObservationRunRecord[],
  referenceTime: Date
): StaleDuplicateSource[] {
  return sources
    .filter((source) => source.enabled && source.kind !== "MANUAL")
    .flatMap((source) => {
      const summary = sourceConsecutiveDuplicateOnlySummary(source.id, runs);
      if (summary.consecutiveDuplicateOnlyCount < SOURCE_DUPLICATE_STALENESS_THRESHOLD || !summary.latestDuplicateOnlyAt) return [];
      const retryAfterAt = new Date(summary.latestDuplicateOnlyAt.getTime() + SOURCE_DUPLICATE_RETRY_COOLDOWN_MS);
      if (referenceTime.getTime() >= retryAfterAt.getTime()) return [];
      return [
        {
          source,
          consecutiveDuplicateOnlyCount: summary.consecutiveDuplicateOnlyCount,
          latestDuplicateOnlyAt: summary.latestDuplicateOnlyAt,
          retryAfterAt
        }
      ];
    });
}

export function lowQualityEvidenceSources(
  sources: ObservationSourceRecord[],
  observations: ObservationRecord[],
  evidence: EvidenceRecord[],
  updates: BayesianUpdateEventRecord[]
): LowQualitySource[] {
  return sources
    .filter((source) => source.enabled && source.kind !== "MANUAL")
    .map((source) => ({
      source,
      quality: summarizeSourceEvidenceQuality(source.id, { observations, evidence, updates })
    }))
    .map((item) => ({
      ...item,
      adjustment: recommendSourceEvidenceQualityAdjustment(item.source, item.quality) ?? undefined
    }))
    .filter((item) => item.quality.tone === "warning")
    .sort(
      (a, b) =>
        b.quality.problemRate - a.quality.problemRate ||
        b.quality.problemEvidenceCount - a.quality.problemEvidenceCount ||
        a.source.name.localeCompare(b.source.name)
    );
}

export function sourceEvidenceQualityAutoApplyRisk(input: SourceEvidenceQualityInput & {
  sources: ObservationSourceRecord[];
  sourceIds?: string[];
}): LowQualitySource | null {
  const sourceIds = new Set(input.sourceIds?.filter(Boolean) ?? []);
  const scopedSources = sourceIds.size > 0 ? input.sources.filter((source) => sourceIds.has(source.id)) : input.sources;
  return (
    lowQualityEvidenceSources(scopedSources, input.observations, input.evidence, input.updates).find(
      (item) =>
        item.quality.evidenceCount >= SOURCE_AUTO_APPLY_RISK_MIN_EVIDENCE &&
        item.quality.problemRate >= SOURCE_AUTO_APPLY_RISK_PROBLEM_RATE_THRESHOLD
    ) ?? null
  );
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
    lastNotice: truncateErrorMessage(heartbeat.lastNotice),
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
    lastNotice: hasFailures ? "" : truncateErrorMessage(heartbeat?.lastNotice || heartbeat?.lastError),
    lastError: hasFailures ? truncateErrorMessage(heartbeat?.lastError) : ""
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
      lastNotice: "",
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
    tone: "healthy",
    lastNotice: truncateErrorMessage(heartbeat.lastNotice || heartbeat.lastError),
    lastError: ""
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
      openObservationCount: undefined,
      duplicateObservationCount: undefined,
      llmScorerReady: undefined,
      llmEvaluation: undefined,
      sources: [],
      observations: [],
      evidence: [],
      updates: [],
      beliefs: [],
      latestUnmatchedObservationCode: undefined
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
    openObservationCount: options?.openObservationCount,
    duplicateObservationCount: options?.duplicateObservationCount,
    llmScorerReady: options?.llmScorerReady,
    llmEvaluation: options?.llmEvaluation,
    sources: options?.sources ?? [],
    observations: options?.observations ?? [],
    evidence: options?.evidence ?? [],
    updates: options?.updates ?? [],
    beliefs: options?.beliefs ?? [],
    latestUnmatchedObservationCode: options?.latestUnmatchedObservationCode
  };
}

function isFetchFailure(message: string) {
  return /fetch failed|failed to fetch|network|timeout|enotfound|econn|etimedout/i.test(message);
}

function diagnosticRetryAfterSummary(items: Array<{ retryAfterAt: Date }>) {
  const retryAfter = items.map((item) => item.retryAfterAt).sort((a, b) => a.getTime() - b.getTime())[0];
  return retryAfter ? `预计重试 ${formatRetryAfterAt(retryAfter)}` : "";
}

function automationPrerequisitesReady(input: {
  sourceCount?: number;
  enabledSourceCount?: number;
  activeBeliefCount?: number;
  activeHypothesisCount?: number;
  effectiveHypothesisCount?: number;
}) {
  return (
    (input.sourceCount ?? 0) > 0 &&
    (input.enabledSourceCount ?? 0) > 0 &&
    (input.activeBeliefCount ?? 0) > 0 &&
    (input.activeHypothesisCount ?? 0) > 0 &&
    (input.effectiveHypothesisCount ?? 0) > 0
  );
}

function oneSidedBeliefCount(beliefs: BeliefRecord[] = [], referenceTime = new Date()) {
  return beliefs.filter((belief) => {
    if (belief.status !== "ACTIVE") return false;
    const effectiveHypotheses = belief.hypotheses.filter((hypothesis) => isHypothesisCurrentlyEffective(hypothesis, referenceTime));
    const hasSupport = effectiveHypotheses.some((hypothesis) => hypothesis.stance === "SUPPORTS");
    const hasOppose = effectiveHypotheses.some((hypothesis) => hypothesis.stance === "OPPOSES");
    return (hasSupport || hasOppose) && hasSupport !== hasOppose;
  }).length;
}

const LLM_DIRECTION_ACCURACY_LABELS = {
  SUPPORTS: "支持",
  OPPOSES: "反对",
  NEUTRAL: "中性"
} as const;

function llmLowDirectionAccuracySummary(summary: LlmEvaluationArtifact["summary"]) {
  return (["SUPPORTS", "OPPOSES", "NEUTRAL"] as const).flatMap((label) => {
    const accuracy = summary.directionAccuracy[label]?.accuracy;
    if (accuracy === null || accuracy === undefined || accuracy >= LLM_EVALUATION_DIRECTION_ACCURACY_WARNING_THRESHOLD) {
      return [];
    }
    return [`${LLM_DIRECTION_ACCURACY_LABELS[label]} ${formatPercentage(accuracy)}`];
  });
}

function llmMissingScoredDirections(summary: LlmEvaluationArtifact["summary"]) {
  return (["SUPPORTS", "OPPOSES", "NEUTRAL"] as const).flatMap((label) => {
    const bucket = summary.directionAccuracy[label];
    return bucket && bucket.scored > 0 ? [] : [LLM_DIRECTION_ACCURACY_LABELS[label]];
  });
}

export function llmEvaluationDiagnostics(
  llmEvaluation: LlmEvaluationArtifact | null | undefined,
  options?: LlmEvaluationDiagnosticsOptions
): AutomationDiagnostic[] {
  if (!llmEvaluation) {
    return [
      {
        level: "warning",
        title: "LLM 主评分器未评估",
        detail: "LLM API 已配置为 v1 主评分器，但没有最近评估结果；运行真实样本评估后再依赖自动应用。"
      }
    ];
  }

  const summary = llmEvaluation.summary;
  const referenceTime = llmEvaluationReferenceTime(options);
  if (summary.sampleCount < MIN_LLM_EVALUATION_SAMPLE_COUNT) {
    return [
      {
        level: "warning",
        title: "LLM 评估样本不足",
        detail: `最近一次 LLM 评估只有 ${summary.sampleCount} 条真实样本，自动应用前应扩大评估样本。`
      }
    ];
  }

  const diagnostics: AutomationDiagnostic[] = [];
  if (!llmEvaluation.generatedAt) {
    diagnostics.push({
      level: "warning",
      title: "LLM 评估时间缺失",
      detail: "最近一次 LLM 评估缺少生成时间，自动应用前应重新运行真实样本评估。"
    });
  }
  if (isLlmEvaluationStale(llmEvaluation, referenceTime)) {
    diagnostics.push({
      level: "warning",
      title: "LLM 评估结果陈旧",
      detail: `最近一次 LLM 评估已超过 ${LLM_EVALUATION_MAX_AGE_DAYS} 天，自动应用前应重新运行真实样本评估。`
    });
  }
  const localFeedbackSampleCount = (summary.sourceCounts?.local_confirmed ?? 0) + (summary.sourceCounts?.local_resolved ?? 0);
  if (localFeedbackSampleCount === 0) {
    diagnostics.push({
      level: "warning",
      title: "LLM 评估未覆盖本地证据",
      detail: "最近一次 LLM 评估没有本地确认证据或已结算假设样本，自动应用前应纳入当前信念/假设/证据链路。"
    });
  }
  const platformSampleCount =
    (summary.sourceCounts?.github ?? 0) + (summary.sourceCounts?.hugging_face ?? 0) + (summary.sourceCounts?.manifold ?? 0);
  if (platformSampleCount === 0) {
    diagnostics.push({
      level: "warning",
      title: "LLM 评估未覆盖真实平台样本",
      detail: "最近一次 LLM 评估没有 GitHub、Hugging Face Hub 或 Manifold 样本，自动应用前应纳入真实平台样本。"
    });
  }
  const missingScoredDirections = llmMissingScoredDirections(summary);
  if (missingScoredDirections.length > 0) {
    diagnostics.push({
      level: "warning",
      title: "LLM 评估方向覆盖不足",
      detail: `最近一次 LLM 评估缺少已评分方向：${missingScoredDirections.join("、")}；自动应用前应补齐支持、反对和中性样本。`
    });
  }
  if (summary.reviewRequiredRate > LLM_EVALUATION_REVIEW_RATE_THRESHOLD) {
    diagnostics.push({
      level: "warning",
      title: "LLM 评估复核率偏高",
      detail: `最近一次 LLM 评估中 ${formatPercentage(summary.reviewRequiredRate)} 样本需要人工复核，自动应用前应调低阈值或保持待审模式。`
    });
  }
  const lowDirectionAccuracies = llmLowDirectionAccuracySummary(summary);
  if (lowDirectionAccuracies.length > 0) {
    diagnostics.push({
      level: "warning",
      title: "LLM 评估方向准确率偏低",
      detail: `最近一次 LLM 评估方向准确率偏低：${lowDirectionAccuracies.join("、")}；建议抽样复核提示词、样本标签和自动应用阈值。`
    });
  }
  if ((summary.fallbackDivergenceRate ?? 0) > LLM_EVALUATION_FALLBACK_DIVERGENCE_RATE_THRESHOLD) {
    diagnostics.push({
      level: "warning",
      title: "LLM 与 fallback 分歧偏高",
      detail: `最近一次 LLM 评估中 ${formatPercentage(summary.fallbackDivergenceRate ?? 0)} 样本与 fallback 方向分歧，自动应用前应抽样复核评分理由。`
    });
  }
  return diagnostics;
}

export function llmEvaluationAutoApplyRisk(
  llmEvaluation: LlmEvaluationArtifact | null | undefined,
  options?: LlmEvaluationDiagnosticsOptions
) {
  return (
    llmEvaluationDiagnostics(llmEvaluation, options).find(
      (diagnostic) =>
        diagnostic.title === "LLM 主评分器未评估" ||
        diagnostic.title === "LLM 评估样本不足" ||
        diagnostic.title === "LLM 评估时间缺失" ||
        diagnostic.title === "LLM 评估结果陈旧" ||
        diagnostic.title === "LLM 评估方向覆盖不足" ||
        diagnostic.title === "LLM 评估复核率偏高" ||
        diagnostic.title === "LLM 评估方向准确率偏低" ||
        diagnostic.title === "LLM 与 fallback 分歧偏高"
    ) ?? null
  );
}

function llmEvaluationReferenceTime(options?: LlmEvaluationDiagnosticsOptions) {
  if (options instanceof Date) return options;
  return options?.referenceTime ?? new Date();
}

function isLlmEvaluationStale(llmEvaluation: LlmEvaluationArtifact, referenceTime: Date) {
  if (!llmEvaluation.generatedAt) return false;
  return referenceTime.getTime() - llmEvaluation.generatedAt.getTime() > LLM_EVALUATION_MAX_AGE_DAYS * DAY_MS;
}

function automationDiagnostics(input: {
  sourceCount?: number;
  enabledSourceCount?: number;
  activeBeliefCount?: number;
  activeHypothesisCount?: number;
  effectiveHypothesisCount?: number;
  openObservationCount?: number;
  duplicateObservationCount?: number;
  llmScorerReady?: boolean;
  llmEvaluation?: LlmEvaluationArtifact | null;
  oneSidedBeliefCount?: number;
  latestRun?: ObservationRunRecord;
  latestFailedRun?: ObservationRunRecord;
  suppressedSources: SuppressedAutomationSource[];
  staleDuplicateSources: StaleDuplicateSource[];
  lowQualitySources: LowQualitySource[];
  worker: AutomationWorkerSummary;
  referenceTime: Date;
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

  if ((input.oneSidedBeliefCount ?? 0) > 0) {
    diagnostics.push({
      level: "warning",
      title: "假设覆盖单向",
      detail: `${input.oneSidedBeliefCount} 个活跃信念只有支持或反证单边假设，自动闭环可能放大确认偏误；先补充缺失方向假设。`
    });
  }

  if (input.suppressedSources.length > 0) {
    const names = input.suppressedSources
      .slice(0, 3)
      .map((item) => item.source.name)
      .join("、");
    const remaining = input.suppressedSources.length > 3 ? ` 等 ${input.suppressedSources.length} 个来源` : "";
    const retryAfter = diagnosticRetryAfterSummary(input.suppressedSources);
    diagnostics.push({
      level: "warning",
      title: "来源已自动降噪",
      detail: retryAfter
        ? `${names}${remaining} 已连续失败至少 ${SOURCE_FAILURE_SUPPRESSION_THRESHOLD} 次，自动闭环会暂时跳过；${retryAfter}，手动运行来源可验证恢复。`
        : `${names}${remaining} 已连续失败至少 ${SOURCE_FAILURE_SUPPRESSION_THRESHOLD} 次，自动闭环会暂时跳过；手动运行来源可验证恢复。`
    });
  }

  if (input.staleDuplicateSources.length > 0) {
    const names = input.staleDuplicateSources
      .slice(0, 3)
      .map((item) => item.source.name)
      .join("、");
    const remaining = input.staleDuplicateSources.length > 3 ? ` 等 ${input.staleDuplicateSources.length} 个来源` : "";
    const retryAfter = diagnosticRetryAfterSummary(input.staleDuplicateSources);
    diagnostics.push({
      level: "warning",
      title: "来源缺少增量",
      detail: retryAfter
        ? `${names}${remaining} 已连续 ${SOURCE_DUPLICATE_STALENESS_THRESHOLD} 次只产生重复观察；${retryAfter}，调整查询、来源 URL 或停用低增量来源。`
        : `${names}${remaining} 已连续 ${SOURCE_DUPLICATE_STALENESS_THRESHOLD} 次只产生重复观察；调整查询、来源 URL 或停用低增量来源。`
    });
  }

  if (input.lowQualitySources.length > 0) {
    const selected = input.lowQualitySources[0];
    const remaining = input.lowQualitySources.length > 1 ? ` 等 ${input.lowQualitySources.length} 个来源` : "";
    const recommendation = selected.adjustment?.detail ?? "建议提高自动确认阈值或暂时停用。";
    diagnostics.push({
      level: "warning",
      title: "来源证据质量偏低",
      detail: `${selected.source.name}${remaining} 的证据质量偏低：${selected.quality.problemEvidenceCount}/${selected.quality.evidenceCount} 条证据出现拒绝或回滚（${formatPercentage(
        selected.quality.problemRate
      )}，回滚 ${selected.quality.rolledBackUpdateCount}，拒绝 ${selected.quality.rejectedEvidenceCount}）；${recommendation}`
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
    input.latestRun.lowImpactCount > 0
  ) {
    diagnostics.push({
      level: "info",
      title: "低影响观察已过滤",
      detail: `${input.latestRun.lowImpactCount} 条观察相关但预期概率变化过小，已保留在未知证据队列。`
    });
  }

  if (
    input.latestRun &&
    input.latestRun.status !== "FAILED" &&
    input.latestRun.queryCount > 0 &&
    input.latestRun.itemCount > 0 &&
    input.latestRun.unmatchedCount > 0
  ) {
    diagnostics.push({
      level: "info",
      title: "未识别候选证据",
      detail: `${input.latestRun.unmatchedCount} 条观察没有匹配到当前假设，收窄假设表述、调整来源或降低候选识别阈值。`
    });
  }

  if (
    input.latestRun &&
    input.latestRun.status !== "FAILED" &&
    input.latestRun.queryCount > 0 &&
    input.latestRun.itemCount > 0 &&
    input.latestRun.candidateCount === 0 &&
    input.latestRun.lowImpactCount === 0 &&
    input.latestRun.unmatchedCount === 0
  ) {
    if (isDuplicateOnlyRun(input.latestRun)) {
      diagnostics.push({
        level: "info",
        title: "观察已全部去重",
        detail: `${input.latestRun.deduplicatedCount} 条采集观察已被判定为重复，说明来源暂时没有提供新信息。`
      });
    } else {
      diagnostics.push({
        level: "info",
        title: "未识别候选证据",
        detail: "收窄假设表述、调整来源或降低候选识别阈值。"
      });
    }
  }

  if (input.worker.label === "心跳过期") {
    diagnostics.push({
      level: "error",
      title: "守护进程心跳过期",
      detail: "重新启动守护进程，或检查本地服务进程是否仍在运行。"
    });
  } else if (automationPrerequisitesReady(input) && (input.worker.label === "未注册" || input.worker.label === "已停止")) {
    diagnostics.push({
      level: "warning",
      title: "守护进程未开启",
      detail: "基础条件已满足，但本地守护进程没有运行；启动后才能按周期自动搜集观察和证据。"
    });
  }

  if ((input.openObservationCount ?? 0) > 0) {
    diagnostics.push({
      level: "info",
      title: "观察等待处理",
      detail: `${input.openObservationCount} 条观察尚未确认为证据，处理后才能继续更新对应假设和信念。`
    });
  }

  if ((input.duplicateObservationCount ?? 0) > 0) {
    diagnostics.push({
      level: "info",
      title: "重复候选等待处理",
      detail: `${input.duplicateObservationCount} 条采集观察被判定为重复候选，核对后拒绝或保留为来源调整线索。`
    });
  }

  if (input.llmScorerReady === false) {
    diagnostics.push({
      level: "warning",
      title: "LLM 主评分器未配置",
      detail: "LLM API 是 v1 主评分器；缺少配置时，候选识别和似然评分会退化为 fallback 或待审。"
    });
  } else if (input.llmScorerReady === true) {
    diagnostics.push(...llmEvaluationDiagnostics(input.llmEvaluation, input.referenceTime));
  }

  return diagnostics;
}

function addNextAction(actions: AutomationNextAction[], action: AutomationNextAction) {
  if (!actions.some((item) => item.href === action.href && item.label === action.label)) {
    actions.push(action);
  }
}

function unmatchedRecommendationHref(observationCode: string | undefined) {
  const code = observationCode?.trim();
  if (!code) return "/admin/world-model/beliefs";
  return `/admin/world-model/beliefs?sourceObservation=${encodeURIComponent(code)}#recommendations`;
}

function automationNextActions(diagnostics: AutomationDiagnostic[], latestUnmatchedObservationCode?: string): AutomationNextAction[] {
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
    if (diagnostic.title === "假设覆盖单向") {
      addNextAction(actions, {
        label: "补齐假设覆盖",
        href: "/admin/world-model/beliefs#recommendations"
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
        href: "/admin/world-model/observations#review-candidates"
      });
      addNextAction(actions, {
        label: "启用自动应用",
        href: "/admin/world-model/sources#evidence-loop"
      });
    }
    if (diagnostic.title === "未识别候选证据") {
      addNextAction(actions, {
        label: "基于观察补充假设",
        href: unmatchedRecommendationHref(latestUnmatchedObservationCode)
      });
    }
    if (diagnostic.title === "低影响观察已过滤") {
      addNextAction(actions, {
        label: "查看低影响观察",
        href: "/admin/world-model/observations#unknown-evidence"
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
    if (diagnostic.title === "来源缺少增量") {
      addNextAction(actions, {
        label: "调整采集来源",
        href: "/admin/world-model/sources#source-list"
      });
    }
    if (diagnostic.title === "来源证据质量偏低") {
      addNextAction(actions, {
        label: "调整采集来源",
        href: "/admin/world-model/sources#source-list"
      });
    }
    if (diagnostic.title === "观察已全部去重") {
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
    if (diagnostic.title === "守护进程未开启") {
      addNextAction(actions, {
        label: "启动守护进程",
        href: "/admin/world-model/sources#automation-worker"
      });
    }
    if (diagnostic.title === "观察等待处理") {
      addNextAction(actions, {
        label: "处理观察积压",
        href: "/admin/world-model/observations#pending-observations"
      });
    }
    if (diagnostic.title === "重复候选等待处理") {
      addNextAction(actions, {
        label: "处理重复候选",
        href: "/admin/world-model/observations#duplicate-candidates"
      });
    }
    if (diagnostic.title === "LLM 主评分器未配置") {
      addNextAction(actions, {
        label: "检查模型配置",
        href: "/admin/world-model/models"
      });
    }
    if (
      diagnostic.title === "LLM 主评分器未评估" ||
      diagnostic.title === "LLM 评估时间缺失" ||
      diagnostic.title === "LLM 评估结果陈旧" ||
      diagnostic.title === "LLM 评估样本不足" ||
      diagnostic.title === "LLM 评估未覆盖本地证据" ||
      diagnostic.title === "LLM 评估未覆盖真实平台样本" ||
      diagnostic.title === "LLM 评估复核率偏高" ||
      diagnostic.title === "LLM 评估方向准确率偏低" ||
      diagnostic.title === "LLM 与 fallback 分歧偏高"
    ) {
      addNextAction(actions, {
        label: "查看模型评估",
        href: "/admin/world-model/models"
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
  latestCounts: Pick<
    ObservationRunRecord,
    | "itemCount"
    | "reprocessedObservationCount"
    | "candidateCount"
    | "autoAppliedCount"
    | "reviewCount"
    | "lowImpactCount"
    | "unmatchedCount"
  >;
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
    openObservationCount,
    duplicateObservationCount,
    llmScorerReady,
    llmEvaluation,
    sources,
    observations,
    evidence,
    updates,
    beliefs,
    latestUnmatchedObservationCode
  } = normalizeHealthOptions(options);
  const orderedRuns = sortedRuns(runs);
  const latestRun = orderedRuns[0];
  const worker = summarizeWorker(heartbeats, referenceTime, workerRuntime);
  const latestFailedRun = orderedRuns.find((run) => run.status === "FAILED");
  const suppressedSources = suppressedAutomationSources(sources, orderedRuns, referenceTime);
  const staleSources = staleDuplicateSources(sources, orderedRuns, referenceTime);
  const lowQualitySources = lowQualityEvidenceSources(sources, observations, evidence, updates);
  const diagnostics = automationDiagnostics({
    sourceCount,
    enabledSourceCount,
    activeBeliefCount,
    activeHypothesisCount,
    effectiveHypothesisCount,
    openObservationCount,
    duplicateObservationCount,
    llmScorerReady,
    llmEvaluation,
    oneSidedBeliefCount: oneSidedBeliefCount(beliefs, referenceTime),
    latestRun,
    latestFailedRun,
    suppressedSources,
    staleDuplicateSources: staleSources,
    lowQualitySources,
    worker,
    referenceTime
  });
  const nextActions = automationNextActions(diagnostics, latestUnmatchedObservationCode);

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
        reprocessedObservationCount: 0,
        candidateCount: 0,
        autoAppliedCount: 0,
        reviewCount: 0,
        lowImpactCount: 0,
        unmatchedCount: 0
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
      reprocessedObservationCount: latestRun.reprocessedObservationCount,
      candidateCount: latestRun.candidateCount,
      autoAppliedCount: latestRun.autoAppliedCount,
      reviewCount: latestRun.reviewCount,
      lowImpactCount: latestRun.lowImpactCount,
      unmatchedCount: latestRun.unmatchedCount
    },
    worker,
    diagnostics,
    nextActions
  };
}
