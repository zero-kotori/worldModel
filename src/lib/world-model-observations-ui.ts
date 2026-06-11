import type { ConfirmEvidenceInput, ObservationRecord, ObservationStatus } from "@/server/services/types";

type RecommendedLink = ConfirmEvidenceInput["links"][number];

export const observationStatusLabels: Record<ObservationStatus, string> = {
  PENDING: "待处理",
  DUPLICATE: "重复候选",
  UNKNOWN: "未知证据",
  CONFIRMED: "已确认",
  REJECTED: "已拒绝"
};

function isDirection(value: unknown): value is RecommendedLink["direction"] {
  return value === "SUPPORTS" || value === "OPPOSES" || value === "MIXED" || value === "NEUTRAL";
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
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

  return {
    hypothesisId: candidate.hypothesisId,
    direction: candidate.direction,
    relevance,
    likelihoodRatio,
    confidence,
    rationale: candidate.rationale.trim()
  };
}

export function getObservationRecommendedLinks(observation: ObservationRecord): RecommendedLink[] {
  const links = observation.metadata.recommendedLinks;
  if (!Array.isArray(links)) return [];
  return links.map(toRecommendedLink).filter((link): link is RecommendedLink => Boolean(link));
}

export function observationReviewPriority(observation: ObservationRecord) {
  const links = getObservationRecommendedLinks(observation);
  if (links.length === 0) return 0;
  return Math.max(
    ...links.map((link) => Math.abs(Math.log(link.likelihoodRatio)) * link.relevance * link.confidence * observation.credibility)
  );
}

export function observationReviewPriorityLabel(score: number) {
  if (score >= 0.35) return "高优先级";
  if (score >= 0.12) return "中优先级";
  return "低优先级";
}

function reviewCandidateSort(a: ObservationRecord, b: ObservationRecord) {
  const priorityDelta = observationReviewPriority(b) - observationReviewPriority(a);
  if (Math.abs(priorityDelta) > 0.000001) return priorityDelta;
  return b.observedAt.getTime() - a.observedAt.getTime();
}

export function groupObservationsForReview(observations: ObservationRecord[]) {
  const reviewCandidates = observations
    .filter((observation) => observation.status === "PENDING" && getObservationRecommendedLinks(observation).length > 0)
    .sort(reviewCandidateSort);

  return {
    unknown: observations.filter((observation) => observation.status === "UNKNOWN"),
    duplicates: observations.filter((observation) => observation.status === "DUPLICATE"),
    reviewCandidates,
    activePool: observations.filter(
      (observation) => observation.status === "PENDING" && getObservationRecommendedLinks(observation).length === 0
    )
  };
}
