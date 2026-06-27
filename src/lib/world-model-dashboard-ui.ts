import type { BayesianUpdateEventRecord, BeliefRecord, EvidenceRecord, ObservationRecord } from "@/server/services/types";
import { isHypothesisCurrentlyEffective } from "@/lib/world-model-beliefs-ui";
import { groupObservationsForReview } from "@/lib/world-model-observations-ui";

type ActionLevel = "error" | "warning" | "info";

type AutomationDiagnostic = {
  level: ActionLevel;
  title: string;
  detail: string;
};

type AutomationNextAction = {
  label: string;
  href: string;
};

type AutomationWorkerNotice = {
  lastNotice?: string;
};

type DashboardActionInput = {
  observations: ObservationRecord[];
  beliefs?: BeliefRecord[];
  evidence?: EvidenceRecord[];
  updates?: BayesianUpdateEventRecord[];
  hypothesisCode?: (hypothesisId: string) => string;
  observationCode?: (observationId: string) => string;
  hypothesisLabel?: (hypothesisId: string) => string;
  beliefLabel?: (beliefId: string) => string;
  updateLabel?: (updateId: string) => string;
  evidenceLabel?: (evidenceId: string) => string;
  sourceLabel?: (sourceId: string) => string;
  reviewDueHypothesisCount: number;
  automation: {
    diagnostics: AutomationDiagnostic[];
    nextActions: AutomationNextAction[];
    worker?: AutomationWorkerNotice;
  };
};

const LARGE_UPDATE_REVIEW_THRESHOLD = 0.05;
const THIN_EVIDENCE_UNCERTAINTY_THRESHOLD = 0.66;
const CALIBRATION_REVIEW_ERROR_THRESHOLD = 0.35;
const COUNTER_EVIDENCE_PROBABILITY_THRESHOLD = 0.8;
const STALE_EVIDENCE_REVIEW_DAYS = 30;
const FRAGILE_CERTAINTY_PROBABILITY_THRESHOLD = 0.85;
const FRAGILE_CERTAINTY_QUALITY_THRESHOLD = 0.55;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DashboardAction = {
  label: string;
  detail: string;
  href: string;
  level: ActionLevel;
};

export type ResolvedHypothesisCalibrationSummary = {
  resolvedCount: number;
  trueCount: number;
  falseCount: number;
  brierScore: number | null;
  meanPredictedProbability: number | null;
  tone: "empty" | "healthy" | "warning";
  label: string;
  detail: string;
  examples: Array<{
    beliefId: string;
    hypothesisId: string;
    beliefLabel: string;
    hypothesisLabel: string;
    outcomeLabel: "发生" | "未发生";
    predictedProbability: number;
    error: number;
    resolvedOutcome?: string;
  }>;
};

type ResolvedHypothesisCalibrationOptions = {
  beliefLabel?: (beliefId: string) => string;
  hypothesisLabel?: (hypothesisId: string) => string;
};

const automationActionDiagnosticTitles: Record<string, string[]> = {
  添加推荐来源: ["缺少采集来源", "没有启用来源"],
  创建信念表: ["缺少活跃信念"],
  补充假设: ["缺少活跃假设"],
  补齐假设覆盖: ["假设覆盖单向"],
  基于观察补充假设: ["未识别候选证据"],
  检查来源配置: ["来源抓取失败", "来源已自动降噪"],
  处理待审候选: ["候选等待确认"],
  启用自动应用: ["候选等待确认"],
  调整信念假设: ["未识别候选证据", "没有当前有效假设"],
  查看低影响观察: ["低影响观察已过滤"],
  调整采集来源: ["未采集观察", "来源缺少增量", "来源证据质量偏低", "观察已全部去重"],
  检查守护进程: ["守护进程心跳过期"],
  启动守护进程: ["守护进程未开启"],
  处理观察积压: ["观察等待处理"],
  检查模型配置: ["LLM 主评分器未配置"],
  查看模型评估: [
    "LLM 主评分器未评估",
    "LLM 评估结果陈旧",
    "LLM 评估时间缺失",
    "LLM 评估样本不足",
    "LLM 评估未覆盖本地证据",
    "LLM 评估未覆盖真实平台样本",
    "LLM 评估复核率偏高",
    "LLM 评估方向准确率偏低",
    "LLM 与 fallback 分歧偏高"
  ]
};

function actionRank(level: ActionLevel) {
  if (level === "error") return 0;
  if (level === "warning") return 1;
  return 2;
}

function actionPriority(label: string) {
  if (label === "复盘大幅更新") return 0;
  if (label === "复查问题来源") return 0.75;
  if (label === "核查回滚证据") return 1;
  if (label === "复盘校准偏差") return 1.5;
  if (label === "补充校准假设") return 1.6;
  if (label === "复盘冲突证据") return 2;
  if (label === "启用自动应用") return 2.1;
  if (label === "启动守护进程" || label === "检查守护进程") return 2.2;
  if (label === "查看守护进程提示") return 2.3;
  if (label === "主动寻找反证") return 2.5;
  if (label === "补强脆弱判断") return 2.6;
  if (label === "复查旧证据") return 2.75;
  if (label === "优先采集薄证据假设") return 3;
  return 10;
}

function addDashboardAction(actions: DashboardAction[], action: DashboardAction) {
  if (!actions.some((item) => item.label === action.label && item.href === action.href)) {
    actions.push(action);
  }
}

function diagnosticForAction(action: AutomationNextAction, diagnostics: AutomationDiagnostic[]) {
  const titles = automationActionDiagnosticTitles[action.label] ?? [];
  return diagnostics.find((diagnostic) => titles.includes(diagnostic.title));
}

function metadataNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function formatPointDelta(value: number) {
  const points = value * 100;
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(1)}pp`;
}

function resolvedOutcomeValue(status: string) {
  if (status === "RESOLVED_TRUE") return 1;
  if (status === "RESOLVED_FALSE") return 0;
  return null;
}

export function summarizeResolvedHypothesisCalibration(
  beliefs: BeliefRecord[],
  options: ResolvedHypothesisCalibrationOptions = {}
): ResolvedHypothesisCalibrationSummary {
  const beliefLabel = options.beliefLabel ?? ((id: string) => id);
  const hypothesisLabel = options.hypothesisLabel ?? ((id: string) => id);
  const rows = beliefs.flatMap((belief) =>
    belief.hypotheses.flatMap((hypothesis) => {
      const outcome = resolvedOutcomeValue(hypothesis.status);
      if (outcome === null) return [];
      const predictedProbability = Math.min(1, Math.max(0, hypothesis.currentProbability));
      const error = Math.abs(predictedProbability - outcome);
      return {
        beliefId: belief.id,
        hypothesisId: hypothesis.id,
        beliefLabel: beliefLabel(belief.id),
        hypothesisLabel: hypothesisLabel(hypothesis.id),
        outcomeLabel: outcome === 1 ? ("发生" as const) : ("未发生" as const),
        predictedProbability,
        error,
        resolvedOutcome: hypothesis.resolvedOutcome
      };
    })
  );

  if (rows.length === 0) {
    return {
      resolvedCount: 0,
      trueCount: 0,
      falseCount: 0,
      brierScore: null,
      meanPredictedProbability: null,
      tone: "empty",
      label: "暂无结算样本",
      detail: "还没有已验证或已证伪的假设。",
      examples: []
    };
  }

  const trueCount = rows.filter((row) => row.outcomeLabel === "发生").length;
  const falseCount = rows.length - trueCount;
  const brierScore = rows.reduce((sum, row) => sum + row.error ** 2, 0) / rows.length;
  const meanPredictedProbability = rows.reduce((sum, row) => sum + row.predictedProbability, 0) / rows.length;
  const tone = brierScore <= 0.12 ? "healthy" : "warning";
  const label = tone === "healthy" ? "校准良好" : "校准偏差偏高";

  return {
    resolvedCount: rows.length,
    trueCount,
    falseCount,
    brierScore,
    meanPredictedProbability,
    tone,
    label,
    detail: `已结算 ${rows.length} 个假设，发生 ${trueCount} 个，未发生 ${falseCount} 个，Brier ${brierScore.toFixed(3)}。`,
    examples: rows.sort((left, right) => right.error - left.error || left.hypothesisId.localeCompare(right.hypothesisId)).slice(0, 3)
  };
}

function largestUpdateDelta(event: BayesianUpdateEventRecord) {
  const hypothesisIds = new Set([...Object.keys(event.priorSnapshot), ...Object.keys(event.posteriorSnapshot)]);
  let selected: { hypothesisId: string; delta: number } | null = null;

  for (const hypothesisId of hypothesisIds) {
    const prior = event.priorSnapshot[hypothesisId] ?? 0;
    const posterior = event.posteriorSnapshot[hypothesisId] ?? prior;
    const delta = posterior - prior;
    if (!selected || Math.abs(delta) > Math.abs(selected.delta)) {
      selected = { hypothesisId, delta };
    }
  }

  return selected;
}

function graphUpdateHref(updateCode: string) {
  const params = new URLSearchParams({ update: updateCode });
  return `/admin/world-model/graph?${params.toString()}`;
}

function graphBeliefHref(beliefCode?: string) {
  if (!beliefCode) return "/admin/world-model/graph";
  const params = new URLSearchParams({ belief: beliefCode });
  return `/admin/world-model/graph?${params.toString()}`;
}

function beliefRecommendationsHref(beliefCode?: string) {
  if (!beliefCode) return "/admin/world-model/beliefs#recommendations";
  const params = new URLSearchParams({ belief: beliefCode });
  return `/admin/world-model/beliefs?${params.toString()}#recommendations`;
}

function graphHypothesisHref(hypothesisCode: string) {
  const params = new URLSearchParams({ hypothesis: hypothesisCode });
  return `/admin/world-model/graph?${params.toString()}`;
}

function evidenceUpdateHref(updateCode: string) {
  const params = new URLSearchParams({ update: updateCode });
  return `/admin/world-model/evidence?${params.toString()}#update-events`;
}

function sourceListHref() {
  return "/admin/world-model/sources#source-list";
}

function evidenceLoopHref(beliefCode?: string) {
  if (!beliefCode) return "/admin/world-model/sources#evidence-loop";
  const params = new URLSearchParams({ belief: beliefCode });
  return `/admin/world-model/sources?${params.toString()}#evidence-loop`;
}

function sourceObservationRecommendationHref(observationCode?: string) {
  const code = observationCode?.trim();
  if (!code) return "/admin/world-model/beliefs";
  const params = new URLSearchParams({ sourceObservation: code });
  return `/admin/world-model/beliefs?${params.toString()}#recommendations`;
}

function probabilityUncertainty(probability: number) {
  const clamped = Math.min(1, Math.max(0, probability));
  return Math.min(1, Math.max(0, 1 - Math.abs(clamped - 0.5) * 2));
}

function activeEvidenceCountsByHypothesis(evidence: EvidenceRecord[] | undefined) {
  const counts = new Map<string, number>();

  for (const item of evidence ?? []) {
    if (item.status !== "ACTIVE") continue;

    const linkedHypothesisIds = new Set(item.links.map((link) => link.hypothesisId));
    for (const hypothesisId of linkedHypothesisIds) {
      counts.set(hypothesisId, (counts.get(hypothesisId) ?? 0) + 1);
    }
  }

  return counts;
}

function activeEvidenceDirectionCountsByHypothesis(evidence: EvidenceRecord[] | undefined) {
  const counts = new Map<string, { supportEvidenceIds: Set<string>; opposingEvidenceIds: Set<string> }>();

  for (const item of evidence ?? []) {
    if (item.status !== "ACTIVE") continue;

    for (const link of item.links) {
      if (link.direction !== "SUPPORTS" && link.direction !== "OPPOSES") continue;

      const existing =
        counts.get(link.hypothesisId) ?? {
          supportEvidenceIds: new Set<string>(),
          opposingEvidenceIds: new Set<string>()
        };
      if (link.direction === "SUPPORTS") {
        existing.supportEvidenceIds.add(item.id);
      } else {
        existing.opposingEvidenceIds.add(item.id);
      }
      counts.set(link.hypothesisId, existing);
    }
  }

  return counts;
}

function activeEvidenceLatestConfirmedAtByHypothesis(evidence: EvidenceRecord[] | undefined) {
  const latest = new Map<string, Date>();

  for (const item of evidence ?? []) {
    if (item.status !== "ACTIVE") continue;

    for (const link of item.links) {
      const existing = latest.get(link.hypothesisId);
      if (!existing || item.confirmedAt.getTime() > existing.getTime()) {
        latest.set(link.hypothesisId, item.confirmedAt);
      }
    }
  }

  return latest;
}

function activeEvidenceQualityByHypothesis(evidence: EvidenceRecord[] | undefined) {
  const quality = new Map<
    string,
    {
      evidenceIds: Set<string>;
      relevanceSum: number;
      confidenceSum: number;
      linkCount: number;
    }
  >();

  for (const item of evidence ?? []) {
    if (item.status !== "ACTIVE") continue;

    for (const link of item.links) {
      const existing =
        quality.get(link.hypothesisId) ?? {
          evidenceIds: new Set<string>(),
          relevanceSum: 0,
          confidenceSum: 0,
          linkCount: 0
        };
      existing.evidenceIds.add(item.id);
      existing.relevanceSum += link.relevance;
      existing.confidenceSum += link.confidence;
      existing.linkCount += 1;
      quality.set(link.hypothesisId, existing);
    }
  }

  return quality;
}

function isFragileCertaintyProbability(probability: number) {
  return probability >= FRAGILE_CERTAINTY_PROBABILITY_THRESHOLD || probability <= 1 - FRAGILE_CERTAINTY_PROBABILITY_THRESHOLD;
}

function evidenceAgeDays(confirmedAt: Date, referenceTime: Date) {
  return Math.max(0, Math.floor((referenceTime.getTime() - confirmedAt.getTime()) / DAY_MS));
}

function counterEvidenceGapAction(
  input: DashboardActionInput,
  hypothesisLabel: (hypothesisId: string) => string,
  beliefLabel: (beliefId: string) => string
): DashboardAction | null {
  const directionCounts = activeEvidenceDirectionCountsByHypothesis(input.evidence);
  const referenceTime = new Date();
  let selected: { id: string; beliefId: string; probability: number; supportCount: number; index: number } | null = null;
  let index = 0;

  for (const belief of input.beliefs ?? []) {
    if (belief.status !== "ACTIVE") continue;

    for (const hypothesis of belief.hypotheses) {
      const currentIndex = index;
      index += 1;

      if (!isHypothesisCurrentlyEffective(hypothesis, referenceTime)) continue;
      if (hypothesis.currentProbability < COUNTER_EVIDENCE_PROBABILITY_THRESHOLD) continue;

      const counts = directionCounts.get(hypothesis.id);
      const supportCount = counts?.supportEvidenceIds.size ?? 0;
      const opposingCount = counts?.opposingEvidenceIds.size ?? 0;
      if (supportCount === 0 || opposingCount > 0) continue;

      if (
        !selected ||
        hypothesis.currentProbability > selected.probability ||
        (hypothesis.currentProbability === selected.probability && supportCount > selected.supportCount) ||
        (hypothesis.currentProbability === selected.probability && supportCount === selected.supportCount && currentIndex < selected.index)
      ) {
        selected = { id: hypothesis.id, beliefId: belief.id, probability: hypothesis.currentProbability, supportCount, index: currentIndex };
      }
    }
  }

  if (!selected) return null;

  return {
    label: "主动寻找反证",
    detail: `${hypothesisLabel(selected.id)} 当前概率 ${(selected.probability * 100).toFixed(
      1
    )}%，已有 ${selected.supportCount} 条支持证据但没有反向证据；建议优先采集能削弱它的观察。`,
    href: evidenceLoopHref(beliefLabel(selected.beliefId)),
    level: "warning"
  };
}

function staleEvidenceAction(
  input: DashboardActionInput,
  hypothesisLabel: (hypothesisId: string) => string,
  beliefLabel: (beliefId: string) => string
): DashboardAction | null {
  const latestConfirmedAt = activeEvidenceLatestConfirmedAtByHypothesis(input.evidence);
  const referenceTime = new Date();
  let selected: { id: string; beliefId: string; ageDays: number; index: number } | null = null;
  let index = 0;

  for (const belief of input.beliefs ?? []) {
    if (belief.status !== "ACTIVE") continue;

    for (const hypothesis of belief.hypotheses) {
      const currentIndex = index;
      index += 1;

      if (!isHypothesisCurrentlyEffective(hypothesis, referenceTime)) continue;
      const latestEvidenceAt = latestConfirmedAt.get(hypothesis.id);
      if (!latestEvidenceAt) continue;

      const ageDays = evidenceAgeDays(latestEvidenceAt, referenceTime);
      if (ageDays < STALE_EVIDENCE_REVIEW_DAYS) continue;

      if (!selected || ageDays > selected.ageDays || (ageDays === selected.ageDays && currentIndex < selected.index)) {
        selected = { id: hypothesis.id, beliefId: belief.id, ageDays, index: currentIndex };
      }
    }
  }

  if (!selected) return null;

  return {
    label: "复查旧证据",
    detail: `${hypothesisLabel(selected.id)} 最近活跃证据已 ${selected.ageDays} 天未更新；建议重新采集观察，避免旧信息锁定判断。`,
    href: evidenceLoopHref(beliefLabel(selected.beliefId)),
    level: "warning"
  };
}

function fragileCertaintyAction(
  input: DashboardActionInput,
  hypothesisLabel: (hypothesisId: string) => string,
  beliefLabel: (beliefId: string) => string
): DashboardAction | null {
  const qualityByHypothesis = activeEvidenceQualityByHypothesis(input.evidence);
  const referenceTime = new Date();
  let selected:
    | {
        id: string;
        beliefId: string;
        probability: number;
        evidenceCount: number;
        averageRelevance: number;
        averageConfidence: number;
        certainty: number;
        qualityGap: number;
        index: number;
      }
    | null = null;
  let index = 0;

  for (const belief of input.beliefs ?? []) {
    if (belief.status !== "ACTIVE") continue;

    for (const hypothesis of belief.hypotheses) {
      const currentIndex = index;
      index += 1;

      if (!isHypothesisCurrentlyEffective(hypothesis, referenceTime)) continue;
      if (!isFragileCertaintyProbability(hypothesis.currentProbability)) continue;

      const quality = qualityByHypothesis.get(hypothesis.id);
      if (!quality || quality.linkCount === 0) continue;

      const averageRelevance = quality.relevanceSum / quality.linkCount;
      const averageConfidence = quality.confidenceSum / quality.linkCount;
      if (averageRelevance >= FRAGILE_CERTAINTY_QUALITY_THRESHOLD && averageConfidence >= FRAGILE_CERTAINTY_QUALITY_THRESHOLD) {
        continue;
      }

      const certainty = Math.abs(hypothesis.currentProbability - 0.5);
      const qualityGap = Math.max(FRAGILE_CERTAINTY_QUALITY_THRESHOLD - averageRelevance, FRAGILE_CERTAINTY_QUALITY_THRESHOLD - averageConfidence);
      if (
        !selected ||
        qualityGap > selected.qualityGap ||
        (qualityGap === selected.qualityGap && certainty > selected.certainty) ||
        (qualityGap === selected.qualityGap && certainty === selected.certainty && currentIndex < selected.index)
      ) {
        selected = {
          id: hypothesis.id,
          beliefId: belief.id,
          probability: hypothesis.currentProbability,
          evidenceCount: quality.evidenceIds.size,
          averageRelevance,
          averageConfidence,
          certainty,
          qualityGap,
          index: currentIndex
        };
      }
    }
  }

  if (!selected) return null;

  return {
    label: "补强脆弱判断",
    detail: `${hypothesisLabel(selected.id)} 当前概率 ${(selected.probability * 100).toFixed(
      1
    )}%，但证据质量偏弱（${selected.evidenceCount} 条活跃证据，平均相关性 ${selected.averageRelevance.toFixed(
      2
    )}，平均置信度 ${selected.averageConfidence.toFixed(2)}）；建议运行自动闭环补充高质量证据或反证。`,
    href: evidenceLoopHref(beliefLabel(selected.beliefId)),
    level: "warning"
  };
}

function thinEvidenceHypothesisAction(
  input: DashboardActionInput,
  hypothesisLabel: (hypothesisId: string) => string,
  beliefLabel: (beliefId: string) => string
): DashboardAction | null {
  const evidenceCounts = activeEvidenceCountsByHypothesis(input.evidence);
  const referenceTime = new Date();
  let selected: { id: string; beliefId: string; probability: number; priority: number; index: number } | null = null;
  let index = 0;

  for (const belief of input.beliefs ?? []) {
    if (belief.status !== "ACTIVE") continue;

    for (const hypothesis of belief.hypotheses) {
      const currentIndex = index;
      index += 1;

      if (!isHypothesisCurrentlyEffective(hypothesis, referenceTime)) continue;
      if ((evidenceCounts.get(hypothesis.id) ?? 0) > 0) continue;

      const uncertainty = probabilityUncertainty(hypothesis.currentProbability);
      if (uncertainty < THIN_EVIDENCE_UNCERTAINTY_THRESHOLD) continue;

      const evidenceGap = 1;
      const priority = Math.min(1, uncertainty * 0.7 + evidenceGap * 0.3);
      if (!selected || priority > selected.priority || (priority === selected.priority && currentIndex < selected.index)) {
        selected = { id: hypothesis.id, beliefId: belief.id, probability: hypothesis.currentProbability, priority, index: currentIndex };
      }
    }
  }

  if (!selected) return null;

  return {
    label: "优先采集薄证据假设",
    detail: `${hypothesisLabel(selected.id)} 当前概率 ${(selected.probability * 100).toFixed(
      1
    )}%，暂无活跃证据；建议运行自动闭环优先采集观察。`,
    href: evidenceLoopHref(beliefLabel(selected.beliefId)),
    level: "warning"
  };
}

function isLlmScoringBlockedObservation(observation: ObservationRecord) {
  const value = observation.metadata.candidateEvaluation;
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  const estimator = typeof candidate.estimator === "string" ? candidate.estimator.trim().toLowerCase() : "";
  const attemptedCount = metadataNonNegativeInteger(candidate.attemptedCount) ?? 0;
  const usableCount = metadataNonNegativeInteger(candidate.usableCount) ?? 0;
  const abstainedCount = metadataNonNegativeInteger(candidate.abstainedCount) ?? 0;

  return estimator === "llm" && attemptedCount > 0 && usableCount === 0 && abstainedCount > 0;
}

function conflictingEvidenceAction(
  input: DashboardActionInput,
  hypothesisCode: (hypothesisId: string) => string | undefined,
  hypothesisLabel: (hypothesisId: string) => string,
  beliefLabel: (beliefId: string) => string
): DashboardAction | null {
  const hypothesisBeliefIds = new Map<string, string>();
  for (const belief of input.beliefs ?? []) {
    for (const hypothesis of belief.hypotheses) {
      hypothesisBeliefIds.set(hypothesis.id, belief.id);
    }
  }

  const byHypothesis = new Map<
    string,
    {
      supportEvidenceIds: Set<string>;
      opposingEvidenceIds: Set<string>;
      latestConfirmedAt: number;
    }
  >();

  for (const evidence of input.evidence ?? []) {
    if (evidence.status !== "ACTIVE") continue;

    for (const link of evidence.links) {
      if (link.direction !== "SUPPORTS" && link.direction !== "OPPOSES") continue;

      const item =
        byHypothesis.get(link.hypothesisId) ??
        {
          supportEvidenceIds: new Set<string>(),
          opposingEvidenceIds: new Set<string>(),
          latestConfirmedAt: 0
        };

      if (link.direction === "SUPPORTS") {
        item.supportEvidenceIds.add(evidence.id);
      } else {
        item.opposingEvidenceIds.add(evidence.id);
      }
      item.latestConfirmedAt = Math.max(item.latestConfirmedAt, evidence.confirmedAt.getTime());
      byHypothesis.set(link.hypothesisId, item);
    }
  }

  const conflict = [...byHypothesis.entries()]
    .map(([hypothesisId, item]) => ({
      hypothesisId,
      supportCount: item.supportEvidenceIds.size,
      opposingCount: item.opposingEvidenceIds.size,
      latestConfirmedAt: item.latestConfirmedAt
    }))
    .filter((item) => item.supportCount > 0 && item.opposingCount > 0)
    .sort(
      (a, b) =>
        b.supportCount + b.opposingCount - (a.supportCount + a.opposingCount) ||
        b.latestConfirmedAt - a.latestConfirmedAt ||
        a.hypothesisId.localeCompare(b.hypothesisId)
    )[0];

  if (!conflict) return null;

  const beliefId = hypothesisBeliefIds.get(conflict.hypothesisId);
  const code = hypothesisCode(conflict.hypothesisId);
  return {
    label: "复盘冲突证据",
    detail: `${hypothesisLabel(conflict.hypothesisId)} 同时存在 ${conflict.supportCount} 条支持证据和 ${conflict.opposingCount} 条反对证据，建议在图谱中复盘关联、相关性和似然权重。`,
    href: code ? graphHypothesisHref(code) : graphBeliefHref(beliefId ? beliefLabel(beliefId) : undefined),
    level: "warning"
  };
}

function calibrationReviewAction(
  input: DashboardActionInput,
  hypothesisCode: (hypothesisId: string) => string | undefined,
  hypothesisLabel: (hypothesisId: string) => string,
  beliefLabel: (beliefId: string) => string
): DashboardAction | null {
  if (!input.beliefs || input.beliefs.length === 0) return null;

  const calibration = summarizeResolvedHypothesisCalibration(input.beliefs, { beliefLabel, hypothesisLabel });
  const example = calibration.examples[0];
  if (!example || example.error < CALIBRATION_REVIEW_ERROR_THRESHOLD) return null;

  const code = hypothesisCode(example.hypothesisId);
  return {
    label: "复盘校准偏差",
    detail: `${example.hypothesisLabel} 结算为${example.outcomeLabel}，结算概率 ${(
      example.predictedProbability * 100
    ).toFixed(1)}%，误差 ${(example.error * 100).toFixed(1)}pp；建议复盘证据关联、补充反证或调整同类假设。`,
    href: code ? graphHypothesisHref(code) : graphBeliefHref(example.beliefLabel),
    level: "warning"
  };
}

function calibrationRepairAction(
  input: DashboardActionInput,
  hypothesisLabel: (hypothesisId: string) => string,
  beliefLabel: (beliefId: string) => string
): DashboardAction | null {
  if (!input.beliefs || input.beliefs.length === 0) return null;

  const calibration = summarizeResolvedHypothesisCalibration(input.beliefs, { beliefLabel, hypothesisLabel });
  const example = calibration.examples[0];
  if (!example || example.error < CALIBRATION_REVIEW_ERROR_THRESHOLD) return null;

  return {
    label: "补充校准假设",
    detail: `${example.beliefLabel} 存在高误差结算样本 ${example.hypothesisLabel}，进入推荐区补充可验证的修复假设。`,
    href: beliefRecommendationsHref(example.beliefLabel),
    level: "warning"
  };
}

function rolledBackSourceQualityAction(
  input: DashboardActionInput,
  updateLabel: (updateId: string) => string,
  evidenceLabel: (evidenceId: string) => string,
  sourceLabel: (sourceId: string) => string
): DashboardAction | null {
  const evidenceById = new Map((input.evidence ?? []).map((item) => [item.id, item]));
  const observationById = new Map(input.observations.map((item) => [item.id, item]));
  const selected = (input.updates ?? [])
    .filter((event) => event.status === "ROLLED_BACK")
    .flatMap((event) => {
      const evidence = evidenceById.get(event.evidenceId);
      const observation = evidence ? observationById.get(evidence.observationId) : undefined;
      if (!observation?.sourceId) return [];
      return [
        {
          event,
          sourceId: observation.sourceId,
          timestamp: event.rolledBackAt?.getTime() ?? event.createdAt.getTime()
        }
      ];
    })
    .sort((a, b) => b.timestamp - a.timestamp || a.sourceId.localeCompare(b.sourceId))[0];

  if (!selected) return null;

  const updateCode = updateLabel(selected.event.id);
  const evidenceCode = evidenceLabel(selected.event.evidenceId);
  return {
    label: "复查问题来源",
    detail: `${sourceLabel(
      selected.sourceId
    )} 产出的 ${evidenceCode} 已产生回滚更新 ${updateCode}；建议复查来源可信度、自动确认阈值或暂时停用。`,
    href: sourceListHref(),
    level: "warning"
  };
}

export function summarizeDashboardActions(input: DashboardActionInput): DashboardAction[] {
  const grouped = groupObservationsForReview(input.observations);
  const actions: DashboardAction[] = [];
  const hypothesisCode = input.hypothesisCode ?? (() => undefined);
  const observationCode = input.observationCode ?? (() => undefined);
  const hypothesisLabel = input.hypothesisLabel ?? ((id: string) => id);
  const beliefLabel = input.beliefLabel ?? ((id: string) => id);
  const updateLabel = input.updateLabel ?? ((id: string) => id);
  const evidenceLabel = input.evidenceLabel ?? ((id: string) => id);
  const sourceLabel = input.sourceLabel ?? ((id: string) => id);

  if (grouped.reviewCandidates.length > 0) {
    addDashboardAction(actions, {
      label: "处理待审候选",
      detail: `${grouped.reviewCandidates.length} 条候选已有推荐关联，确认后可以直接更新对应假设和信念。`,
      href: "/admin/world-model/observations#review-candidates",
      level: "warning"
    });
  }

  const unmatchedUnknown = grouped.unknown.filter((observation) => observation.metadata.ignoredReason === "UNMATCHED");
  const scorerBlockedUnknownCount = unmatchedUnknown.filter(isLlmScoringBlockedObservation).length;
  if (scorerBlockedUnknownCount > 0) {
    addDashboardAction(actions, {
      label: "查看评分诊断",
      detail: `${scorerBlockedUnknownCount} 条未匹配观察已尝试 LLM 评分但没有可用输出，先检查模型配置、API 状态或评分诊断。`,
      href: "/admin/world-model/observations#unknown-evidence",
      level: "warning"
    });
  }

  const unmatchedUnknownCount = unmatchedUnknown.length - scorerBlockedUnknownCount;
  if (unmatchedUnknownCount > 0) {
    const latestUnblockedUnmatched = unmatchedUnknown
      .filter((observation) => !isLlmScoringBlockedObservation(observation))
      .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())[0];
    addDashboardAction(actions, {
      label: "基于观察补充假设",
      detail: `${unmatchedUnknownCount} 条未匹配观察可以转化为新假设，补充后会重新进入证据待审。`,
      href: sourceObservationRecommendationHref(latestUnblockedUnmatched ? observationCode(latestUnblockedUnmatched.id) : undefined),
      level: "warning"
    });
  }

  const lowImpactUnknownCount = grouped.unknown.filter((observation) => observation.metadata.ignoredReason === "LOW_IMPACT").length;
  if (lowImpactUnknownCount > 0) {
    addDashboardAction(actions, {
      label: "查看低影响观察",
      detail: `${lowImpactUnknownCount} 条观察相关但预期概率变化较小，可以人工确认或拒绝。`,
      href: "/admin/world-model/observations#unknown-evidence",
      level: "info"
    });
  }

  if (grouped.duplicates.length > 0) {
    addDashboardAction(actions, {
      label: "处理重复候选",
      detail: `${grouped.duplicates.length} 条重复候选需要核对原始观察后拒绝或重新采集来源。`,
      href: "/admin/world-model/observations#duplicate-candidates",
      level: "info"
    });
  }

  const unresolvedUnknownCount = grouped.unknown.length - scorerBlockedUnknownCount - unmatchedUnknownCount - lowImpactUnknownCount;
  const unlinkedObservationCount = grouped.activePool.length + unresolvedUnknownCount;
  if (unlinkedObservationCount > 0) {
    addDashboardAction(actions, {
      label: "处理观察积压",
      detail: `${unlinkedObservationCount} 条观察尚未确认为证据或拒绝。`,
      href: "/admin/world-model/observations",
      level: "info"
    });
  }

  if (input.reviewDueHypothesisCount > 0) {
    addDashboardAction(actions, {
      label: "复核假设时效",
      detail: `${input.reviewDueHypothesisCount} 个假设已到复核窗口，需要续期、归档或调整。`,
      href: "/admin/world-model/beliefs?view=review-due",
      level: "warning"
    });
  }

  const conflictingEvidence = conflictingEvidenceAction(input, hypothesisCode, hypothesisLabel, beliefLabel);
  if (conflictingEvidence) {
    addDashboardAction(actions, conflictingEvidence);
  }

  const calibrationReview = calibrationReviewAction(input, hypothesisCode, hypothesisLabel, beliefLabel);
  if (calibrationReview) {
    addDashboardAction(actions, calibrationReview);
  }

  const calibrationRepair = calibrationRepairAction(input, hypothesisLabel, beliefLabel);
  if (calibrationRepair) {
    addDashboardAction(actions, calibrationRepair);
  }

  const counterEvidenceGap = counterEvidenceGapAction(input, hypothesisLabel, beliefLabel);
  if (counterEvidenceGap) {
    addDashboardAction(actions, counterEvidenceGap);
  }

  const staleEvidence = staleEvidenceAction(input, hypothesisLabel, beliefLabel);
  if (staleEvidence) {
    addDashboardAction(actions, staleEvidence);
  }

  const fragileCertainty = fragileCertaintyAction(input, hypothesisLabel, beliefLabel);
  if (fragileCertainty) {
    addDashboardAction(actions, fragileCertainty);
  }

  const thinEvidenceAction = thinEvidenceHypothesisAction(input, hypothesisLabel, beliefLabel);
  if (thinEvidenceAction) {
    addDashboardAction(actions, thinEvidenceAction);
  }

  const largeUpdate = (input.updates ?? [])
    .filter((event) => event.status === "APPLIED")
    .map((event) => ({ event, delta: largestUpdateDelta(event)?.delta ?? 0 }))
    .filter((item) => Math.abs(item.delta) >= LARGE_UPDATE_REVIEW_THRESHOLD)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.event.createdAt.getTime() - a.event.createdAt.getTime())[0];

  if (largeUpdate) {
    const updateCode = updateLabel(largeUpdate.event.id);
    addDashboardAction(actions, {
      label: "复盘大幅更新",
      detail: `${updateCode} · ${evidenceLabel(largeUpdate.event.evidenceId)} 使假设概率变化 ${formatPointDelta(
        largeUpdate.delta
      )}，建议核查证据关联和似然判断。`,
      href: graphUpdateHref(updateCode),
      level: "warning"
    });
  }

  const rolledBackSourceQuality = rolledBackSourceQualityAction(input, updateLabel, evidenceLabel, sourceLabel);
  if (rolledBackSourceQuality) {
    addDashboardAction(actions, rolledBackSourceQuality);
  }

  const workerNotice = input.automation.worker?.lastNotice?.trim();
  if (workerNotice) {
    addDashboardAction(actions, {
      label: "查看守护进程提示",
      detail: workerNotice,
      href: "/admin/world-model/sources#automation-worker",
      level: "info"
    });
  }

  const rolledBackUpdate = (input.updates ?? [])
    .filter((event) => event.status === "ROLLED_BACK")
    .sort(
      (a, b) =>
        (b.rolledBackAt?.getTime() ?? b.createdAt.getTime()) - (a.rolledBackAt?.getTime() ?? a.createdAt.getTime())
    )[0];

  if (rolledBackUpdate) {
    const updateCode = updateLabel(rolledBackUpdate.id);
    addDashboardAction(actions, {
      label: "核查回滚证据",
      detail: `${updateCode} · ${evidenceLabel(
        rolledBackUpdate.evidenceId
      )} 已回滚，确认该证据关系或来源质量是否需要修正。`,
      href: evidenceUpdateHref(updateCode),
      level: "warning"
    });
  }

  for (const action of input.automation.nextActions) {
    const diagnostic = diagnosticForAction(action, input.automation.diagnostics);
    addDashboardAction(actions, {
      label: action.label,
      detail: diagnostic?.detail ?? "自动闭环需要处理。",
      href: action.href,
      level: diagnostic?.level ?? "info"
    });
  }

  return actions
    .map((action, index) => ({ action, index }))
    .sort(
      (a, b) =>
        actionRank(a.action.level) - actionRank(b.action.level) ||
        actionPriority(a.action.label) - actionPriority(b.action.label) ||
        a.index - b.index
    )
    .map(({ action }) => action);
}
