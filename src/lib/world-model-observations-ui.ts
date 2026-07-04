import { createUpdatePreview } from "@/domain/updates";
import type { BeliefRecord, ConfirmEvidenceInput, ObservationRecord, ObservationStatus } from "@/server/services/types";

type RecommendedLink = ConfirmEvidenceInput["links"][number];
type RecommendedEstimatorOutput = NonNullable<RecommendedLink["estimatorOutputs"]>[number];
type CandidateImpactTone = "increase" | "decrease" | "neutral";
type ObservationConversionSummaryOptions = {
  beliefLabel?: (beliefId: string) => string;
  hypothesisLabel?: (hypothesisId: string) => string;
};

export const observationStatusLabels: Record<ObservationStatus, string> = {
  PENDING: "待处理",
  DUPLICATE: "重复候选",
  UNKNOWN: "未知证据",
  CONFIRMED: "已确认",
  REJECTED: "已拒绝",
  SETTLED: "已结算"
};

export function observationIgnoredReasonLabel(reason: unknown) {
  if (reason === "LOW_IMPACT") return "低影响过滤";
  if (reason === "UNMATCHED") return "未匹配假设";
  return "";
}

export function observationReviewReasonLabel(reason: unknown) {
  if (reason === "REVIEW_ONLY") return "待审模式";
  if (reason === "SOURCE_REQUIRES_REVIEW") return "来源待审";
  if (reason === "NO_EFFECTIVE_HYPOTHESIS") return "无有效假设";
  if (reason === "ONE_SIDED_HYPOTHESIS_COVERAGE") return "假设覆盖单向";
  if (reason === "LLM_REVIEW_REQUIRED") return "LLM 要求复核";
  if (reason === "LLM_EVALUATION_RISK") return "LLM 评估风险";
  if (reason === "QUALITY_THRESHOLD") return "阈值待审";
  if (reason === "NEW_HYPOTHESIS_MATCH") return "新增假设匹配";
  if (reason === "RECOMMENDED_HYPOTHESIS_CREATED") return "推荐假设已创建";
  if (reason === "SETTLEMENT_REVIEW") return "结算复盘";
  if (reason === "OBSERVATION_EDIT") return "编辑后重算";
  return "待审队列";
}

function metadataString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function metadataStringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(metadataString).filter(Boolean);
}

function metadataNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

export function observationConversionSummary(
  observation: ObservationRecord,
  options: ObservationConversionSummaryOptions = {}
) {
  if (observation.metadata.convertedFromRecommendation !== true) return "";

  const beliefId = metadataString(observation.metadata.convertedBeliefId);
  const convertedHypothesisIds = metadataStringList(observation.metadata.convertedHypothesisIds);
  const fallbackHypothesisId = metadataString(observation.metadata.convertedHypothesisId);
  const hypothesisIds = convertedHypothesisIds.length > 0 ? convertedHypothesisIds : fallbackHypothesisId ? [fallbackHypothesisId] : [];
  const beliefLabel = options.beliefLabel ?? ((id: string) => id);
  const hypothesisLabel = options.hypothesisLabel ?? ((id: string) => id);
  const targetLabels = [
    ...(beliefId ? [beliefLabel(beliefId)] : []),
    ...(hypothesisIds.length > 0 ? [hypothesisIds.map(hypothesisLabel).join("、")] : [])
  ];

  return targetLabels.length > 0 ? `推荐转入 ${targetLabels.join(" · ")}` : "推荐转入";
}

export function observationCandidateEvaluationSummary(observation: ObservationRecord) {
  const value = observation.metadata.candidateEvaluation;
  if (!value || typeof value !== "object") return "";

  const candidate = value as Record<string, unknown>;
  const attemptedCount = metadataNonNegativeInteger(candidate.attemptedCount);
  const usableCount = metadataNonNegativeInteger(candidate.usableCount);
  if (attemptedCount === null || usableCount === null) return "";

  const estimator = metadataString(candidate.estimator) || "评分器";
  const abstainedCount = metadataNonNegativeInteger(candidate.abstainedCount) ?? 0;
  const rejectedCount = metadataNonNegativeInteger(candidate.rejectedCount) ?? 0;
  const parts = [`${estimator} 评估 ${attemptedCount} 个候选`, `${usableCount} 个可用`];
  if (abstainedCount > 0) parts.push(`${abstainedCount} 个弃权`);
  if (rejectedCount > 0) parts.push(`${rejectedCount} 个低相关`);

  const rationale = metadataString(candidate.latestRationale);
  return rationale ? `${parts.join("，")}；${rationale}` : parts.join("，");
}

export function observationQueryContextSummary(observation: ObservationRecord) {
  const query = metadataString(observation.metadata.query);
  const beliefCode = metadataString(observation.metadata.queryBeliefCode);
  const hypothesisCode = metadataString(observation.metadata.queryHypothesisCode);
  const purpose = metadataString(observation.metadata.queryPurpose);
  const priority = typeof observation.metadata.queryPriority === "number" ? observation.metadata.queryPriority : undefined;
  const priorityReason = metadataString(observation.metadata.queryPriorityReason);
  const target = [hypothesisCode, beliefCode].filter(Boolean).join(" · ");
  const parts = [];
  if (target) {
    parts.push(`${purpose === "SETTLEMENT_REVIEW" ? "结算目标" : "搜证目标"} ${target}`);
  } else if (query) {
    parts.push(purpose === "SETTLEMENT_REVIEW" ? "自动结算搜证" : "自动搜证");
  }
  if (priority !== undefined && Number.isFinite(priority)) {
    parts.push(`优先级 ${priority.toFixed(2)}`);
  }
  if (priorityReason) {
    parts.push(priorityReason);
  }
  if (query) {
    parts.push(`查询：${query}`);
  }
  return parts.join("；");
}

function isDirection(value: unknown): value is RecommendedLink["direction"] {
  return value === "SUPPORTS" || value === "OPPOSES" || value === "MIXED" || value === "NEUTRAL";
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function toRecommendedEstimatorOutput(value: unknown): RecommendedEstimatorOutput | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.estimator !== "string" || !candidate.estimator.trim()) return null;
  if (typeof candidate.weight !== "number" || !Number.isFinite(candidate.weight)) return null;

  const output: RecommendedEstimatorOutput = {
    estimator: candidate.estimator.trim(),
    weight: candidate.weight
  };
  if (isDirection(candidate.direction)) output.direction = candidate.direction;
  if (isProbability(candidate.relevance)) output.relevance = candidate.relevance;
  if (isPositiveNumber(candidate.likelihoodRatio)) output.likelihoodRatio = candidate.likelihoodRatio;
  if (isProbability(candidate.confidence)) output.confidence = candidate.confidence;
  if (typeof candidate.rationale === "string" && candidate.rationale.trim()) {
    output.rationale = candidate.rationale.trim();
  }
  if (typeof candidate.abstain === "boolean") output.abstain = candidate.abstain;
  if (typeof candidate.reviewRequired === "boolean") output.reviewRequired = candidate.reviewRequired;
  if (typeof candidate.modelVersion === "string" && candidate.modelVersion.trim()) {
    output.modelVersion = candidate.modelVersion.trim();
  }
  return output;
}

function recommendedEstimatorOutputs(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(toRecommendedEstimatorOutput).filter((output): output is RecommendedEstimatorOutput => Boolean(output));
}

function formatProbability(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatPointDelta(value: number) {
  const points = value * 100;
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(1)}pp`;
}

function candidateImpactTone(delta: number): CandidateImpactTone {
  if (delta > 0.000001) return "increase";
  if (delta < -0.000001) return "decrease";
  return "neutral";
}

function toRecommendedLink(value: unknown): RecommendedLink | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const relevance = candidate.relevance;
  const likelihoodRatio = candidate.likelihoodRatio;
  const confidence = candidate.confidence;
  if (
    typeof candidate.hypothesisId !== "string" ||
    !candidate.hypothesisId ||
    !isDirection(candidate.direction) ||
    !isProbability(relevance) ||
    !isPositiveNumber(likelihoodRatio) ||
    !isProbability(confidence) ||
    typeof candidate.rationale !== "string" ||
    !candidate.rationale.trim()
  ) {
    return null;
  }

  const estimatorOutputs = recommendedEstimatorOutputs(candidate.estimatorOutputs);
  return {
    hypothesisId: candidate.hypothesisId,
    direction: candidate.direction,
    relevance,
    likelihoodRatio,
    confidence,
    rationale: candidate.rationale.trim(),
    ...(candidate.reviewRequired === true ? { reviewRequired: true } : {}),
    ...(estimatorOutputs.length > 0 ? { estimatorOutputs } : {})
  };
}

export function getObservationRecommendedLinks(observation: ObservationRecord): RecommendedLink[] {
  const links = observation.metadata.recommendedLinks;
  if (!Array.isArray(links)) return [];
  return links.map(toRecommendedLink).filter((link): link is RecommendedLink => Boolean(link));
}

export function observationRecommendedLinkLikelihoodSummary(link: RecommendedLink) {
  const rawLikelihoodRatio = link.estimatorOutputs?.find(
    (output) => typeof output.likelihoodRatio === "number" && Math.abs(output.likelihoodRatio - link.likelihoodRatio) > 0.000001
  )?.likelihoodRatio;
  if (typeof rawLikelihoodRatio === "number") {
    return `有效 LR ${link.likelihoodRatio.toFixed(2)} · 原始 LR ${rawLikelihoodRatio.toFixed(2)}`;
  }
  return `LR ${link.likelihoodRatio.toFixed(2)}`;
}

export function observationReviewPriority(observation: ObservationRecord) {
  const links = getObservationRecommendedLinks(observation);
  if (links.length === 0) return 0;
  return Math.max(
    ...links.map((link) => Math.abs(Math.log(link.likelihoodRatio)) * link.relevance * link.confidence * observation.credibility)
  );
}

export function isSettlementReviewObservation(observation: ObservationRecord) {
  return observation.status === "PENDING" && observation.metadata.reviewReason === "SETTLEMENT_REVIEW";
}

export function observationReviewPriorityLabel(score: number) {
  if (score >= 0.35) return "高优先级";
  if (score >= 0.12) return "中优先级";
  return "低优先级";
}

export function summarizeObservationCandidateImpact(
  observation: ObservationRecord,
  beliefs: BeliefRecord[],
  hypothesisLabel: (hypothesisId: string) => string = (hypothesisId) => hypothesisId
) {
  const links = getObservationRecommendedLinks(observation);
  if (links.length === 0) {
    return {
      label: "无预览",
      detail: "没有可确认的推荐关联。",
      tone: "neutral" as const
    };
  }

  let selected: { hypothesisId: string; prior: number; posterior: number; delta: number } | null = null;

  for (const belief of beliefs) {
    const hypothesisIds = new Set(belief.hypotheses.map((hypothesis) => hypothesis.id));
    const beliefLinks = links.filter((link) => hypothesisIds.has(link.hypothesisId));
    if (beliefLinks.length === 0) continue;

    const preview = createUpdatePreview(
      {
        id: belief.id,
        probabilityMode: belief.probabilityMode,
        hypotheses: belief.hypotheses.map((hypothesis) => ({
          id: hypothesis.id,
          proposition: hypothesis.proposition,
          currentProbability: hypothesis.currentProbability,
          strength: hypothesis.strength
        }))
      },
      beliefLinks.map((link) => ({
        hypothesisId: link.hypothesisId,
        likelihoodRatio: link.likelihoodRatio,
        credibility: observation.credibility,
        confidence: link.confidence,
        rationale: link.rationale
      }))
    );

    for (const hypothesisId of Object.keys(preview.posteriorSnapshot)) {
      const prior = preview.priorSnapshot[hypothesisId] ?? 0;
      const posterior = preview.posteriorSnapshot[hypothesisId] ?? prior;
      const delta = posterior - prior;
      if (!selected || Math.abs(delta) > Math.abs(selected.delta)) {
        selected = { hypothesisId, prior, posterior, delta };
      }
    }
  }

  if (!selected) {
    return {
      label: "无预览",
      detail: "推荐关联缺少当前假设。",
      tone: "neutral" as const
    };
  }

  return {
    label: formatPointDelta(selected.delta),
    detail: `${hypothesisLabel(selected.hypothesisId)} ${formatProbability(selected.prior)} -> ${formatProbability(selected.posterior)}`,
    tone: candidateImpactTone(selected.delta)
  };
}

function reviewCandidateSort(a: ObservationRecord, b: ObservationRecord) {
  const priorityDelta = observationReviewPriority(b) - observationReviewPriority(a);
  if (Math.abs(priorityDelta) > 0.000001) return priorityDelta;
  return b.observedAt.getTime() - a.observedAt.getTime();
}

function pendingObservationSort(a: ObservationRecord, b: ObservationRecord) {
  const credibilityDelta = b.credibility - a.credibility;
  if (Math.abs(credibilityDelta) > 0.000001) return credibilityDelta;
  return b.observedAt.getTime() - a.observedAt.getTime();
}

function unknownObservationSort(a: ObservationRecord, b: ObservationRecord) {
  const priorityDelta = observationReviewPriority(b) - observationReviewPriority(a);
  if (Math.abs(priorityDelta) > 0.000001) return priorityDelta;
  return b.observedAt.getTime() - a.observedAt.getTime();
}

export function groupObservationsForReview(observations: ObservationRecord[]) {
  const reviewCandidates = observations
    .filter(
      (observation) =>
        observation.status === "PENDING" &&
        (getObservationRecommendedLinks(observation).length > 0 || isSettlementReviewObservation(observation))
    )
    .sort(reviewCandidateSort);
  const activePool = observations
    .filter(
      (observation) =>
        observation.status === "PENDING" &&
        getObservationRecommendedLinks(observation).length === 0 &&
        !isSettlementReviewObservation(observation)
    )
    .sort(pendingObservationSort);

  return {
    unknown: observations.filter((observation) => observation.status === "UNKNOWN").sort(unknownObservationSort),
    duplicates: observations.filter((observation) => observation.status === "DUPLICATE"),
    reviewCandidates,
    activePool
  };
}
