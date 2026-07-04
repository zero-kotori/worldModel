import type { EstimatorOutput } from "@/domain/likelihood";
import type { UpdatePreview } from "@/domain/updates";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import { getSourcePreset, sourcePresetDefinitions } from "@/lib/world-model-source-presets";
import type { EstimatorResult } from "@/server/models/estimators";
import { createRecordId } from "@/server/services/in-memory-store";
import type {
  CandidateEvaluationMetadata,
  CandidateObservationProcessingOptions,
  CandidateObservationProcessingResult,
  EvidenceLinkRecommendationOptions,
  EvidenceLinkRecommendationResult
} from "@/server/services/internal/candidate-types";
import { evidenceLinksSchema } from "@/server/services/internal/schemas";
import type { WorldModelServiceContext } from "@/server/services/internal/service-context";
import {
  DEFAULT_CANDIDATE_THRESHOLD,
  DEFAULT_MIN_CANDIDATE_PROBABILITY_DELTA,
  DEFAULT_QUERY_TEMPLATE_SOURCE_KINDS,
  LLM_FALLBACK_CANDIDATE_LIMIT,
  OBSERVATION_RECOMMENDATION_THRESHOLD,
  SOURCE_DUPLICATE_RETRY_COOLDOWN_MS,
  SOURCE_DUPLICATE_STALENESS_THRESHOLD,
  SOURCE_FAILURE_RETRY_COOLDOWN_MS,
  SOURCE_FAILURE_SUPPRESSION_THRESHOLD,
  isCurrentlyEffectiveHypothesis,
  isSettlementReviewDueHypothesis,
  normalizedThreshold,
  now,
  overlapScore
} from "@/server/services/internal/shared";
import { observationSignalText } from "@/server/services/internal/recommendations";
import {
  activeEvidenceCoverageByHypothesis,
  calibrationPressureByBelief,
  evidenceLoopQueryPriority,
  hypothesisEvidenceSearchQuery,
  hypothesisSettlementSearchQuery,
  queryHintScore
} from "@/server/services/internal/evidence-queries";
import { planEvidenceLoopQueriesWithFallback } from "@/server/services/internal/query-planner";
import { createSourceAdapter } from "@/server/sources/adapters";
import type {
  BeliefRecord,
  ConfirmAndApplyEvidenceResult,
  ConfirmEvidenceInput,
  CreateObservationInput,
  EvidenceLoopOptions,
  EvidenceLoopQuery,
  EvidenceLoopResult,
  EvidenceLoopSkippedSource,
  HypothesisRecord,
  ObservationCleanupMode,
  ObservationRecord,
  ObservationRunRecord,
  ObservationSourceRecord,
  RunSourceOptions
} from "@/server/services/types";

const DEFAULT_DUPLICATE_OBSERVATION_CLEANUP: ObservationCleanupMode = "REJECT";
const DEFAULT_UNMATCHED_OBSERVATION_CLEANUP: ObservationCleanupMode = "KEEP";
const DEFAULT_LOW_IMPACT_OBSERVATION_CLEANUP: ObservationCleanupMode = "KEEP";

export type SourceWorkflowDependencies = {
  createObservation(input: CreateObservationInput): Promise<ObservationRecord>;
  confirmAndApplyObservation(input: ConfirmEvidenceInput): Promise<ConfirmAndApplyEvidenceResult>;
  createCandidatePreview(links: ConfirmEvidenceInput["links"], credibility: number): Promise<UpdatePreview>;
};

export type SourceWorkflow = {
  recommendedEvidenceLinks(
    observation: ObservationRecord,
    threshold: number,
    options?: EvidenceLinkRecommendationOptions
  ): Promise<EvidenceLinkRecommendationResult>;
  runSource(sourceId: string, options?: RunSourceOptions): Promise<ObservationRunRecord>;
  runEvidenceLoop(options?: EvidenceLoopOptions): Promise<EvidenceLoopResult>;
  generateEvidenceLoopQueries(options?: EvidenceLoopOptions): Promise<EvidenceLoopQuery[]>;
  createSourcePresetRecord(id: string): Promise<ObservationSourceRecord>;
  createMissingSourcePresetRecords(): Promise<ObservationSourceRecord[]>;
  requeueUnmatchedObservationsForHypothesis(hypothesis: HypothesisRecord): Promise<void>;
  requeueSourceObservationForRecommendedHypotheses(
    sourceObservationId: string | undefined,
    hypotheses: HypothesisRecord[],
    directionForHypothesis?: (hypothesis: HypothesisRecord) => ConfirmEvidenceInput["links"][number]["direction"]
  ): Promise<void>;
  requeueSourceObservationForRecommendedHypothesis(
    sourceObservationId: string | undefined,
    hypothesis: HypothesisRecord
  ): Promise<void>;
};

function sourceSupportsGeneratedQueries(source: Pick<ObservationSourceRecord, "kind" | "url">) {
  return Boolean(source.url?.includes("{query}") || DEFAULT_QUERY_TEMPLATE_SOURCE_KINDS.has(source.kind));
}

function normalizedObservationCleanupMode(value: ObservationCleanupMode | undefined, fallback: ObservationCleanupMode) {
  return value === "REJECT" || value === "DELETE" ? value : fallback;
}

function metadataNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function hasRetryableLlmCandidateEvaluation(metadata: Record<string, unknown>) {
  const value = metadata.candidateEvaluation;
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  const estimator = typeof candidate.estimator === "string" ? candidate.estimator.trim().toLowerCase() : "";
  const attemptedCount = metadataNonNegativeInteger(candidate.attemptedCount) ?? 0;
  const usableCount = metadataNonNegativeInteger(candidate.usableCount) ?? 0;
  const abstainedCount = metadataNonNegativeInteger(candidate.abstainedCount) ?? 0;

  return estimator === "llm" && attemptedCount > 0 && usableCount === 0 && abstainedCount > 0;
}

function candidateEvaluationFromMetadata(metadata: Record<string, unknown>): CandidateEvaluationMetadata | undefined {
  const value = metadata.candidateEvaluation;
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const estimator = typeof candidate.estimator === "string" ? candidate.estimator.trim() : "";
  const attemptedCount = metadataNonNegativeInteger(candidate.attemptedCount);
  const usableCount = metadataNonNegativeInteger(candidate.usableCount);
  const abstainedCount = metadataNonNegativeInteger(candidate.abstainedCount);
  const rejectedCount = metadataNonNegativeInteger(candidate.rejectedCount);
  if (!estimator || attemptedCount === null || usableCount === null || abstainedCount === null || rejectedCount === null) {
    return undefined;
  }
  return {
    estimator,
    attemptedCount,
    usableCount,
    abstainedCount,
    rejectedCount,
    ...(typeof candidate.latestRationale === "string" && candidate.latestRationale.trim()
      ? { latestRationale: candidate.latestRationale.trim() }
      : {})
  };
}

function cleanCandidateLifecycleMetadata(metadata: Record<string, unknown>) {
  const next = { ...metadata };
  delete next.recommendedLinks;
  delete next.reviewReason;
  delete next.ignoredReason;
  delete next.candidateEvaluation;
  return next;
}

function recommendedLinksFromMetadata(metadata: Record<string, unknown>): ConfirmEvidenceInput["links"] {
  const parsed = evidenceLinksSchema.safeParse(metadata.recommendedLinks);
  return parsed.success ? parsed.data : [];
}

function emptyCandidateProcessingResult(): CandidateObservationProcessingResult {
  return {
    candidateCount: 0,
    autoAppliedCount: 0,
    reviewCount: 0,
    lowImpactCount: 0,
    unmatchedCount: 0,
    failureCount: 0,
    errorMessages: []
  };
}

function addCandidateProcessingResult(
  total: CandidateObservationProcessingResult,
  next: CandidateObservationProcessingResult
) {
  total.candidateCount += next.candidateCount;
  total.autoAppliedCount += next.autoAppliedCount;
  total.reviewCount += next.reviewCount;
  total.lowImpactCount += next.lowImpactCount;
  total.unmatchedCount += next.unmatchedCount;
  total.failureCount += next.failureCount;
  total.errorMessages.push(...next.errorMessages);
}

function evidenceLoopResultMode(loopOptions: EvidenceLoopOptions, runs: ObservationRunRecord[]) {
  if (loopOptions.reviewOnly) return "review-only" as const;
  const completedRuns = runs.filter((run) => run.status !== "FAILED");
  const autoAppliedCount = completedRuns.reduce((sum, run) => sum + run.autoAppliedCount, 0);
  if (completedRuns.length > 0 && autoAppliedCount === 0 && completedRuns.every((run) => run.status === "REVIEW_ONLY")) {
    return "review-only" as const;
  }
  return "auto-apply" as const;
}

function isUsableEstimatorOutput(output: EstimatorOutput) {
  return (
    !output.abstain &&
    Number.isFinite(output.likelihoodRatio) &&
    Number.isFinite(output.confidence) &&
    output.likelihoodRatio !== undefined &&
    output.likelihoodRatio > 0 &&
    output.confidence !== undefined &&
    output.confidence > 0 &&
    output.confidence <= 1
  );
}

function normalizeEstimatorResult(result: EstimatorResult): EstimatorOutput[] {
  return Array.isArray(result) ? result : [result];
}

function estimatorDirection(output: EstimatorOutput): "SUPPORTS" | "OPPOSES" | "MIXED" | "NEUTRAL" {
  if (output.direction === "SUPPORTS" || output.direction === "OPPOSES" || output.direction === "MIXED" || output.direction === "NEUTRAL") {
    return output.direction;
  }
  const likelihoodRatio = output.likelihoodRatio ?? 1;
  if (likelihoodRatio > 1.05) return "SUPPORTS";
  if (likelihoodRatio < 0.95) return "OPPOSES";
  return "NEUTRAL";
}

function hostnameFromUrl(value: string | undefined) {
  if (!value) return "";
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function domainMatches(hostname: string, domains: string[]) {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function sourceHosts(observation: ObservationRecord, source: ObservationSourceRecord | null) {
  return [hostnameFromUrl(observation.url), hostnameFromUrl(source?.url)].filter(Boolean);
}

function sourceLikelihoodCap(observation: ObservationRecord, source: ObservationSourceRecord | null) {
  const hosts = sourceHosts(observation, source);
  if (hosts.some((host) => domainMatches(host, ["openai.com", "anthropic.com"]))) return 12;
  if (hosts.some((host) => domainMatches(host, ["arxiv.org", "github.com", "huggingface.co"]))) return 8;
  if (hosts.some((host) => domainMatches(host, ["biggo.com", "gigazine.net"]))) return 2;
  if (source?.kind === "SOCIAL") return 2;
  if (source?.kind === "PREDICTION_MARKET") return 3;
  return 5;
}

function capLikelihoodRatio(likelihoodRatio: number, cap: number) {
  if (likelihoodRatio >= 1) return Math.min(likelihoodRatio, cap);
  return Math.max(likelihoodRatio, 1 / cap);
}

function conservativeLikelihoodRatio(input: {
  likelihoodRatio: number;
  confidence: number;
  reviewRequired?: boolean;
  observation: ObservationRecord;
  source: ObservationSourceRecord | null;
}) {
  const sourceCap = sourceLikelihoodCap(input.observation, input.source);
  const reviewCap = input.reviewRequired ? 3 : sourceCap;
  const confidenceCap = input.confidence < 0.5 ? 1 + (sourceCap - 1) * Math.max(input.confidence, 0) : sourceCap;
  const cap = Math.max(1, Math.min(sourceCap, reviewCap, confidenceCap));
  return capLikelihoodRatio(input.likelihoodRatio, cap);
}

function canAutoApplyLinks(links: ConfirmEvidenceInput["links"], threshold: number) {
  return links.every(
    (link) =>
      link.reviewRequired !== true &&
      link.direction !== "NEUTRAL" &&
      link.relevance >= threshold &&
      link.confidence >= threshold &&
      Number.isFinite(link.likelihoodRatio) &&
      link.likelihoodRatio > 0
  );
}

function linksRequireReview(links: ConfirmEvidenceInput["links"]) {
  return links.some((link) => link.reviewRequired === true);
}

function largestProbabilityDelta(preview: UpdatePreview) {
  const hypothesisIds = new Set([...Object.keys(preview.priorSnapshot), ...Object.keys(preview.posteriorSnapshot)]);
  let largest = 0;
  for (const hypothesisId of hypothesisIds) {
    const prior = preview.priorSnapshot[hypothesisId] ?? 0;
    const posterior = preview.posteriorSnapshot[hypothesisId] ?? prior;
    largest = Math.max(largest, Math.abs(posterior - prior));
  }
  return largest;
}

function candidateReviewReason(input: {
  reviewOnly?: boolean;
  autoConfirm: boolean;
  reviewRequired?: boolean;
  policyReviewReason?: string;
}) {
  if (input.policyReviewReason) return input.policyReviewReason;
  if (input.reviewOnly) return "REVIEW_ONLY";
  if (!input.autoConfirm) return "SOURCE_REQUIRES_REVIEW";
  if (input.reviewRequired) return "LLM_REVIEW_REQUIRED";
  return "QUALITY_THRESHOLD";
}

function observationQueryHint(observation: ObservationRecord) {
  const query = observation.metadata.query;
  return typeof query === "string" && query.trim() ? query.trim() : "";
}

function queryContextByQuery(queries: EvidenceLoopQuery[]) {
  return new Map(queries.map((query) => [query.query, query] as const));
}

function sourceScopedQueries(queries: EvidenceLoopQuery[], source: Pick<ObservationSourceRecord, "kind">) {
  const scoped = queries.filter((query) => !query.sourceKinds || query.sourceKinds.length === 0 || query.sourceKinds.includes(source.kind));
  return scoped.length > 0 ? scoped : queries;
}

function observationMetadataWithQueryContext(
  metadata: Record<string, unknown> | undefined,
  queriesByText: Map<string, EvidenceLoopQuery>
) {
  const next = { ...(metadata ?? {}) };
  const queryText = typeof next.query === "string" && next.query.trim() ? next.query.trim() : "";
  if (!queryText) return next;
  const query = queriesByText.get(queryText);
  if (!query) return next;
  return {
    ...next,
    queryBeliefId: query.beliefId,
    ...(query.beliefCode ? { queryBeliefCode: query.beliefCode } : {}),
    queryHypothesisId: query.hypothesisId,
    ...(query.hypothesisCode ? { queryHypothesisCode: query.hypothesisCode } : {}),
    queryCategory: query.category,
    ...(query.purpose ? { queryPurpose: query.purpose } : {}),
    ...(query.plannerStrategy ? { queryPlannerStrategy: query.plannerStrategy } : {}),
    ...(query.plannerPurpose ? { queryPlannerPurpose: query.plannerPurpose } : {}),
    ...(query.baseQuery ? { queryBaseQuery: query.baseQuery } : {}),
    ...(query.priority !== undefined ? { queryPriority: query.priority } : {}),
    ...(query.priorityReason ? { queryPriorityReason: query.priorityReason } : {}),
    ...(query.uncertainty !== undefined ? { queryUncertainty: query.uncertainty } : {}),
    ...(query.evidenceCount !== undefined ? { queryEvidenceCount: query.evidenceCount } : {}),
    ...(query.settlementDue ? { querySettlementDue: true } : {}),
    ...(query.expiresAt ? { queryExpiresAt: query.expiresAt } : {}),
    ...(query.expiryCondition ? { queryExpiryCondition: query.expiryCondition } : {})
  };
}

export function createSourceWorkflow(
  context: WorldModelServiceContext,
  dependencies: SourceWorkflowDependencies
): SourceWorkflow {
  const { store, options } = context;

  async function applyObservationCleanup(observation: ObservationRecord, mode: ObservationCleanupMode) {
    if (mode === "KEEP") return observation;
    return store.updateObservation(observation.id, { status: mode === "DELETE" ? "DELETED" : "REJECTED" });
  }

  async function recommendedEvidenceLinks(
    observation: ObservationRecord,
    threshold: number,
    recommendationOptions: EvidenceLinkRecommendationOptions = {}
  ): Promise<EvidenceLinkRecommendationResult> {
    const source = observation.sourceId ? await store.getSource(observation.sourceId) : null;
    const signal = `${observation.title}\n${observation.content}`;
    const queryHint = observationQueryHint(observation);
    const scopedBeliefIds = recommendationOptions.beliefIds;
    const beliefs = (await store.listBeliefs()).filter(
      (belief) => !scopedBeliefIds || scopedBeliefIds.size === 0 || scopedBeliefIds.has(belief.id)
    );
    const ranked = beliefs
      .flatMap((belief) =>
        belief.hypotheses
          .filter((hypothesis) => isCurrentlyEffectiveHypothesis(hypothesis))
          .map((hypothesis) => {
            const score = overlapScore(
              signal,
              `${belief.title} ${hypothesis.proposition} ${hypothesis.notes} ${hypothesis.evidenceSearchQuery ?? ""}`
            );
            return { belief, hypothesis, score, queryHintScore: queryHintScore(queryHint, belief, hypothesis) };
          })
      )
      .sort((a, b) => Math.max(b.score, b.queryHintScore) - Math.max(a.score, a.queryHintScore) || b.score - a.score);

    const lexicalMatches = ranked.filter((candidate) => candidate.score >= threshold);

    if (options.likelihoodEstimator) {
      const lexicalHypothesisIds = new Set(lexicalMatches.map((candidate) => candidate.hypothesis.id));
      const queryHintCandidates = ranked
        .filter((candidate) => candidate.queryHintScore >= threshold && !lexicalHypothesisIds.has(candidate.hypothesis.id))
        .slice(0, LLM_FALLBACK_CANDIDATE_LIMIT);
      const llmHypothesisIds = new Set([
        ...lexicalMatches.map((candidate) => candidate.hypothesis.id),
        ...queryHintCandidates.map((candidate) => candidate.hypothesis.id)
      ]);
      const fallbackCandidates =
        queryHintCandidates.length > 0
          ? []
          : ranked.filter((candidate) => !llmHypothesisIds.has(candidate.hypothesis.id)).slice(0, LLM_FALLBACK_CANDIDATE_LIMIT);
      const llmCandidates = [...lexicalMatches, ...queryHintCandidates, ...fallbackCandidates];
      const llmLinks: Array<{
        belief: (typeof llmCandidates)[number]["belief"];
        score: number;
        link: ConfirmEvidenceInput["links"][number];
      }> = [];
      const candidateEvaluation: CandidateEvaluationMetadata = {
        estimator: options.likelihoodEstimator.name,
        attemptedCount: 0,
        usableCount: 0,
        abstainedCount: 0,
        rejectedCount: 0
      };
      let sawUsableOutput = false;

      for (const candidate of llmCandidates) {
        const outputs = normalizeEstimatorResult(await options.likelihoodEstimator.estimate({
          evidenceText: `${observation.title}\n${observation.content}`,
          hypothesis: candidate.hypothesis.proposition,
          category: candidate.belief.category,
          sourceCredibility: observation.credibility,
          evidencePublishedAt: observation.publishedAt,
          evidenceObservedAt: observation.observedAt,
          context: `${candidate.belief.title}\n${candidate.belief.description}\n${candidate.hypothesis.notes}\n${candidate.hypothesis.evidenceSearchQuery ?? ""}`
        }));

        candidateEvaluation.attemptedCount += 1;
        const latestRationale = outputs.find((output) => output.rationale?.trim())?.rationale?.trim();
        if (latestRationale) {
          candidateEvaluation.latestRationale = latestRationale;
        }

        const output = outputs.find(isUsableEstimatorOutput);
        if (!output) {
          if (outputs.some((candidateOutput) => candidateOutput.abstain)) {
            candidateEvaluation.abstainedCount += 1;
          } else {
            candidateEvaluation.rejectedCount += 1;
          }
          continue;
        }
        sawUsableOutput = true;
        candidateEvaluation.usableCount += 1;
        const relevance = output.relevance ?? Math.max(candidate.score, candidate.queryHintScore);
        const likelihoodRatio = conservativeLikelihoodRatio({
          likelihoodRatio: output.likelihoodRatio ?? 1,
          confidence: output.confidence ?? 0.1,
          reviewRequired: output.reviewRequired,
          observation,
          source
        });
        if (relevance < threshold) {
          candidateEvaluation.rejectedCount += 1;
          continue;
        }

        llmLinks.push({
          belief: candidate.belief,
          score: relevance,
          link: {
            hypothesisId: candidate.hypothesis.id,
            direction: estimatorDirection(output),
            relevance,
            likelihoodRatio,
            confidence: output.confidence ?? 0.1,
            rationale:
              output.rationale ??
              `LLM 自动关联到「${candidate.belief.title}」下的假设：${candidate.hypothesis.proposition}`,
            ...(output.reviewRequired ? { reviewRequired: true } : {}),
            estimatorOutputs: outputs
          }
        });
      }

      const sortedLlmLinks = llmLinks.sort((a, b) => b.score - a.score || b.link.confidence - a.link.confidence);
      const bestLlmLink = sortedLlmLinks[0];
      if (bestLlmLink) {
        return {
          links: sortedLlmLinks.filter((candidate) => candidate.belief.id === bestLlmLink.belief.id).map((candidate) => candidate.link),
          ...(candidateEvaluation.attemptedCount > 0 ? { candidateEvaluation } : {})
        };
      }
      if (sawUsableOutput || lexicalMatches.length === 0) {
        return {
          links: [],
          ...(candidateEvaluation.attemptedCount > 0 ? { candidateEvaluation } : {})
        };
      }
    }

    const best = lexicalMatches[0];
    if (!best) return { links: [] };

    const selected = lexicalMatches.filter((candidate) => candidate.belief.id === best.belief.id);
    const links: ConfirmEvidenceInput["links"] = [];

    for (const candidate of selected) {
      links.push({
        hypothesisId: candidate.hypothesis.id,
        direction: "SUPPORTS",
        relevance: Math.min(1, Math.max(0.1, candidate.score)),
        likelihoodRatio: 1 + Math.min(2, candidate.score * 2),
        confidence: Math.min(0.95, Math.max(0.1, candidate.score)),
        rationale: `自动关联到「${candidate.belief.title}」下的假设：${candidate.hypothesis.proposition}`
      });
    }

    return { links };
  }

  async function processCandidateObservation(
    observation: ObservationRecord,
    processingOptions: CandidateObservationProcessingOptions
  ): Promise<CandidateObservationProcessingResult> {
    const result = emptyCandidateProcessingResult();
    if (observation.metadata.queryPurpose === "SETTLEMENT_REVIEW") {
      const cleanMetadata = cleanCandidateLifecycleMetadata(observation.metadata);
      await store.updateObservation(observation.id, {
        status: "PENDING",
        metadata: {
          ...cleanMetadata,
          reviewReason: "SETTLEMENT_REVIEW",
          ...(typeof observation.metadata.queryBeliefId === "string" ? { settlementBeliefId: observation.metadata.queryBeliefId } : {}),
          ...(typeof observation.metadata.queryBeliefCode === "string" ? { settlementBeliefCode: observation.metadata.queryBeliefCode } : {}),
          ...(typeof observation.metadata.queryHypothesisId === "string"
            ? { settlementHypothesisId: observation.metadata.queryHypothesisId }
            : {}),
          ...(typeof observation.metadata.queryHypothesisCode === "string"
            ? { settlementHypothesisCode: observation.metadata.queryHypothesisCode }
            : {}),
          ...(typeof observation.metadata.queryExpiresAt === "string" ? { settlementExpiresAt: observation.metadata.queryExpiresAt } : {}),
          ...(typeof observation.metadata.queryExpiryCondition === "string"
            ? { settlementExpiryCondition: observation.metadata.queryExpiryCondition }
            : {})
        }
      });
      result.reviewCount = 1;
      return result;
    }
    const recommendation = await recommendedEvidenceLinks(observation, processingOptions.candidateThreshold, {
      beliefIds: processingOptions.beliefIds
    });
    const links = recommendation.links;

    if (links.length === 0) {
      const updated = await store.updateObservation(observation.id, {
        status: "UNKNOWN",
        metadata: {
          ...cleanCandidateLifecycleMetadata(observation.metadata),
          ignoredReason: "UNMATCHED",
          ...(recommendation.candidateEvaluation ? { candidateEvaluation: recommendation.candidateEvaluation } : {})
        }
      });
      await applyObservationCleanup(
        updated,
        normalizedObservationCleanupMode(processingOptions.unmatchedObservationCleanup, DEFAULT_UNMATCHED_OBSERVATION_CLEANUP)
      );
      result.unmatchedCount = 1;
      return result;
    }

    const cleanMetadata = cleanCandidateLifecycleMetadata(observation.metadata);
    const preview = await dependencies.createCandidatePreview(links, observation.credibility);
    if (largestProbabilityDelta(preview) < DEFAULT_MIN_CANDIDATE_PROBABILITY_DELTA) {
      const updated = await store.updateObservation(observation.id, {
        status: "UNKNOWN",
        metadata: {
          ...cleanMetadata,
          ignoredReason: "LOW_IMPACT",
          recommendedLinks: links,
          ...(recommendation.candidateEvaluation ? { candidateEvaluation: recommendation.candidateEvaluation } : {})
        }
      });
      await applyObservationCleanup(
        updated,
        normalizedObservationCleanupMode(processingOptions.lowImpactObservationCleanup, DEFAULT_LOW_IMPACT_OBSERVATION_CLEANUP)
      );
      result.lowImpactCount = 1;
      return result;
    }

    result.candidateCount = 1;
    if (
      processingOptions.reviewOnly ||
      !processingOptions.autoConfirm ||
      !canAutoApplyLinks(links, processingOptions.autoApplyThreshold)
    ) {
      await store.updateObservation(observation.id, {
        status: "PENDING",
        metadata: {
          ...cleanMetadata,
          recommendedLinks: links,
          ...(recommendation.candidateEvaluation ? { candidateEvaluation: recommendation.candidateEvaluation } : {}),
          reviewReason: candidateReviewReason({
            reviewOnly: processingOptions.reviewOnly,
            autoConfirm: processingOptions.autoConfirm,
            reviewRequired: linksRequireReview(links),
            policyReviewReason: processingOptions.reviewReason
          })
        }
      });
      result.reviewCount = 1;
      return result;
    }

    await store.updateObservation(observation.id, {
      status: "PENDING",
      metadata: {
        ...cleanMetadata,
        ...(recommendation.candidateEvaluation ? { candidateEvaluation: recommendation.candidateEvaluation } : {})
      }
    });
    await dependencies.confirmAndApplyObservation({
      observationId: observation.id,
      confirmationMode: "AUTO",
      links
    });
    result.autoAppliedCount = 1;
    return result;
  }

  async function processQueuedRecommendedObservation(
    observation: ObservationRecord,
    processingOptions: CandidateObservationProcessingOptions
  ): Promise<CandidateObservationProcessingResult> {
    const result = emptyCandidateProcessingResult();
    const links = recommendedLinksFromMetadata(observation.metadata);
    if (links.length === 0) return result;

    result.candidateCount = 1;
    if (
      processingOptions.reviewOnly ||
      !processingOptions.autoConfirm ||
      !canAutoApplyLinks(links, processingOptions.autoApplyThreshold)
    ) {
      await store.updateObservation(observation.id, {
        status: "PENDING",
        metadata: {
          ...observation.metadata,
          recommendedLinks: links,
          reviewReason:
            typeof observation.metadata.reviewReason === "string"
              ? observation.metadata.reviewReason
              : candidateReviewReason({
                  reviewOnly: processingOptions.reviewOnly,
                  autoConfirm: processingOptions.autoConfirm,
                  reviewRequired: linksRequireReview(links),
                  policyReviewReason: processingOptions.reviewReason
                })
        }
      });
      result.reviewCount = 1;
      return result;
    }

    const queuedCandidateEvaluation = candidateEvaluationFromMetadata(observation.metadata);
    await store.updateObservation(observation.id, {
      status: "PENDING",
      metadata: {
        ...cleanCandidateLifecycleMetadata(observation.metadata),
        ...(queuedCandidateEvaluation ? { candidateEvaluation: queuedCandidateEvaluation } : {})
      }
    });
    await dependencies.confirmAndApplyObservation({
      observationId: observation.id,
      confirmationMode: "AUTO",
      links
    });
    result.autoAppliedCount = 1;
    return result;
  }

  async function requeueUnmatchedObservationsForHypothesis(hypothesis: HypothesisRecord) {
    if (!isCurrentlyEffectiveHypothesis(hypothesis)) return;
    const belief = await store.getBelief(hypothesis.beliefId);
    if (!belief) return;

    const observations = await store.listObservations();
    for (const observation of observations) {
      if (observation.status !== "UNKNOWN" || observation.metadata.ignoredReason !== "UNMATCHED") continue;
      const score = overlapScore(
        observationSignalText(observation),
        `${belief.title} ${hypothesis.proposition} ${hypothesis.notes} ${hypothesis.evidenceSearchQuery ?? ""}`
      );
      if (score < DEFAULT_CANDIDATE_THRESHOLD) continue;

      const metadata = { ...observation.metadata };
      delete metadata.ignoredReason;
      await store.updateObservation(observation.id, {
        status: "PENDING",
        metadata: {
          ...metadata,
          recommendedLinks: [
            {
              hypothesisId: hypothesis.id,
              direction: "SUPPORTS",
              relevance: Math.min(1, Math.max(0.1, score)),
              likelihoodRatio: 1 + Math.min(2, score * 2),
              confidence: Math.min(0.95, Math.max(0.1, score)),
              rationale: `新增假设后重新匹配：${hypothesis.proposition}`
            }
          ],
          reviewReason: "NEW_HYPOTHESIS_MATCH"
        }
      });
    }
  }

  function sourceObservationRecommendedLink(
    observation: ObservationRecord,
    hypothesis: HypothesisRecord,
    direction: ConfirmEvidenceInput["links"][number]["direction"]
  ): ConfirmEvidenceInput["links"][number] {
    const score = Math.max(
      OBSERVATION_RECOMMENDATION_THRESHOLD,
      overlapScore(observationSignalText(observation), `${hypothesis.proposition} ${hypothesis.notes} ${hypothesis.evidenceSearchQuery ?? ""}`)
    );
    const supportRatio = 1 + Math.min(2, score * 2);
    return {
      hypothesisId: hypothesis.id,
      direction,
      relevance: Math.min(1, Math.max(0.1, score)),
      likelihoodRatio: direction === "OPPOSES" ? 1 / supportRatio : supportRatio,
      confidence: Math.min(0.95, Math.max(0.1, score)),
      rationale: `推荐假设创建后重新匹配：${hypothesis.proposition}`
    };
  }

  async function requeueSourceObservationForRecommendedHypotheses(
    sourceObservationId: string | undefined,
    hypotheses: HypothesisRecord[],
    directionForHypothesis: (hypothesis: HypothesisRecord) => ConfirmEvidenceInput["links"][number]["direction"] = () => "SUPPORTS"
  ) {
    const effectiveHypotheses = hypotheses.filter((hypothesis) => isCurrentlyEffectiveHypothesis(hypothesis));
    if (!sourceObservationId || effectiveHypotheses.length === 0) return;
    const observation = await store.getObservation(sourceObservationId);
    if (!observation || observation.status !== "UNKNOWN" || observation.metadata.ignoredReason !== "UNMATCHED") return;

    const metadata = { ...observation.metadata };
    delete metadata.ignoredReason;
    const recommendedLinks = effectiveHypotheses.map((hypothesis) =>
      sourceObservationRecommendedLink(observation, hypothesis, directionForHypothesis(hypothesis))
    );

    await store.updateObservation(observation.id, {
      status: "PENDING",
      metadata: {
        ...metadata,
        recommendedLinks,
        reviewReason: "RECOMMENDED_HYPOTHESIS_CREATED",
        convertedBeliefId: effectiveHypotheses[0].beliefId,
        convertedHypothesisId: effectiveHypotheses[0].id,
        convertedHypothesisIds: effectiveHypotheses.map((hypothesis) => hypothesis.id),
        convertedAt: now().toISOString(),
        convertedFromRecommendation: true
      }
    });
  }

  async function requeueSourceObservationForRecommendedHypothesis(sourceObservationId: string | undefined, hypothesis: HypothesisRecord) {
    await requeueSourceObservationForRecommendedHypotheses(sourceObservationId, [hypothesis]);
  }

  async function generateEvidenceLoopQueries(loopOptions: EvidenceLoopOptions = {}): Promise<EvidenceLoopQuery[]> {
    const beliefIds = new Set(loopOptions.beliefIds?.filter(Boolean));
    const allBeliefs = await store.listBeliefs();
    const evidenceCoverage = activeEvidenceCoverageByHypothesis(await store.listEvidence());
    const beliefCodes = createReadableCodes(allBeliefs, "B", (belief) => belief.createdAt);
    const hypothesisCodes = createReadableCodes(
      allBeliefs.flatMap((belief) => belief.hypotheses),
      "H",
      (hypothesis) => hypothesis.createdAt
    );
    const calibrationPressure = calibrationPressureByBelief(allBeliefs);
    const beliefs = allBeliefs.filter((belief) => {
      if (belief.status !== "ACTIVE") return false;
      return beliefIds.size === 0 || beliefIds.has(belief.id);
    });
    const seen = new Set<string>();
    const queries: EvidenceLoopQuery[] = [];
    const referenceTime = now();

    for (const belief of beliefs) {
      for (const hypothesis of belief.hypotheses) {
        const settlementDue = isSettlementReviewDueHypothesis(hypothesis, referenceTime);
        if (!isCurrentlyEffectiveHypothesis(hypothesis, referenceTime) && !settlementDue) continue;
        const baseQuery = settlementDue ? hypothesisSettlementSearchQuery(belief, hypothesis) : hypothesisEvidenceSearchQuery(belief, hypothesis);
        if (!baseQuery) continue;
        const coverage = evidenceCoverage.get(hypothesis.id) ?? {
          evidenceCount: 0,
          supportEvidenceCount: 0,
          opposingEvidenceCount: 0,
          relevanceSum: 0,
          confidenceSum: 0,
          linkCount: 0
        };
        const calibration = calibrationPressure.get(belief.id);
        const queryPriority = settlementDue
          ? {
              purpose: "SETTLEMENT_REVIEW" as const,
              priority: 1,
              priorityReason: "settlement review due",
              settlementDue: true,
              expiresAt: hypothesis.expiresAt?.toISOString(),
              ...(hypothesis.expiryCondition ? { expiryCondition: hypothesis.expiryCondition } : {})
            }
          : {
              purpose: "EVIDENCE" as const,
              ...evidenceLoopQueryPriority(
                hypothesis,
                coverage,
                calibration
                  ? {
                      ...calibration,
                      hypothesisCode: readableCode(hypothesisCodes, calibration.hypothesisId, "H")
                    }
                  : undefined,
                referenceTime
              )
            };
        const plannedQueries = await planEvidenceLoopQueriesWithFallback(
          { belief, hypothesis, baseQuery, settlementDue },
          options.evidenceQueryPlanner
        );
        for (const [plannerRank, plannedQuery] of plannedQueries.entries()) {
          const key = `${hypothesis.id}:${plannedQuery.purpose}:${plannedQuery.query}`;
          if (!plannedQuery.query || seen.has(key)) continue;
          seen.add(key);
          queries.push({
          beliefId: belief.id,
          beliefCode: readableCode(beliefCodes, belief.id, "B"),
          hypothesisId: hypothesis.id,
          hypothesisCode: readableCode(hypothesisCodes, hypothesis.id, "H"),
          category: belief.category,
            query: plannedQuery.query,
            baseQuery,
            plannerStrategy: plannedQuery.strategy,
            plannerPurpose: plannedQuery.purpose,
            plannerRank,
            sourceKinds: plannedQuery.sourceKinds,
            ...queryPriority
          });
        }
      }
    }

    const prioritizedQueries = queries
      .map((query, index) => ({ query, index }))
      .sort(
        (a, b) =>
          (b.query.priority ?? 0) - (a.query.priority ?? 0) ||
          Number(Boolean(b.query.counterEvidenceGap)) - Number(Boolean(a.query.counterEvidenceGap)) ||
          Number(b.query.staleEvidenceDays !== undefined) - Number(a.query.staleEvidenceDays !== undefined) ||
          Number(Boolean(b.query.fragileCertainty)) - Number(Boolean(a.query.fragileCertainty)) ||
          (a.query.plannerRank ?? 0) - (b.query.plannerRank ?? 0) ||
          a.index - b.index
      )
      .map((item) => item.query);
    const maxQueries = loopOptions.maxQueries && loopOptions.maxQueries > 0 ? Math.floor(loopOptions.maxQueries) : undefined;
    return maxQueries ? prioritizedQueries.slice(0, maxQueries) : prioritizedQueries;
  }

  async function createObservationRunRecord(input: ObservationRunRecord) {
    try {
      return await store.createObservationRun(input);
    } catch (error) {
      if (!input.sourceId) throw error;
      return store.createObservationRun({
        ...input,
        sourceId: undefined,
        status: "FAILED",
        finishedAt: input.finishedAt ?? now(),
        itemCount: input.status === "FAILED" ? input.itemCount : 0,
        reprocessedObservationCount: input.status === "FAILED" ? input.reprocessedObservationCount : 0,
        deduplicatedCount: input.status === "FAILED" ? input.deduplicatedCount : 0,
        candidateCount: input.status === "FAILED" ? input.candidateCount : 0,
        autoAppliedCount: input.status === "FAILED" ? input.autoAppliedCount : 0,
        reviewCount: input.status === "FAILED" ? input.reviewCount : 0,
        lowImpactCount: input.status === "FAILED" ? input.lowImpactCount : 0,
        unmatchedCount: input.status === "FAILED" ? input.unmatchedCount : 0,
        errorMessage: input.errorMessage ?? (error instanceof Error ? error.message : String(error))
      });
    }
  }

  function skippedSourceDiagnosticMessage(skippedSources: EvidenceLoopSkippedSource[]) {
    return skippedSources
      .map((source) => {
        const sourceLabel = [source.sourceCode, source.sourceName].filter(Boolean).join(" · ");
        if (source.reason === "CONSECUTIVE_FAILURES") {
          const latestError = source.latestError ? `；latest error: ${source.latestError}` : "";
          return `${sourceLabel}: CONSECUTIVE_FAILURES (${source.consecutiveFailureCount} consecutive failures${latestError})`;
        }
        return `${sourceLabel}: LOW_INCREMENT (${source.consecutiveDuplicateOnlyCount} duplicate-only runs)`;
      })
      .join("；");
  }

  function noRunnableSourceDiagnosticMessage(allSources: ObservationSourceRecord[], sourceIds: Set<string>) {
    if (sourceIds.size > 0) {
      return "没有可运行来源：指定来源不存在、已停用或为手动来源。";
    }
    if (allSources.length === 0) {
      return "没有可运行来源：当前没有配置非手动且启用的采集来源。";
    }
    return "没有可运行来源：当前没有启用的非手动采集来源。";
  }

  function noRunnableQueryDiagnosticMessage() {
    return "没有可运行查询：当前没有活跃信念或当前信念下没有活跃/待结算假设。";
  }

  async function createSourcePresetRecord(id: string) {
    const preset = getSourcePreset(id);
    if (!preset) throw new Error(`Source preset not found: ${id}`);
    const existing = (await store.listSources()).find((source) => source.url === preset.url || source.name === preset.name);
    if (existing) return existing;
    const createdAt = now();
    return store.createSource({
      id: createRecordId("source"),
      name: preset.name,
      kind: preset.kind,
      url: preset.url,
      adapter: preset.adapter,
      credentialRef: preset.credentialRef,
      credibility: preset.credibility,
      enabled: preset.enabled,
      autoConfirm: preset.autoConfirm,
      autoConfirmThreshold: preset.autoConfirmThreshold,
      createdAt,
      updatedAt: createdAt
    });
  }

  async function bootstrapDefaultSources() {
    const created = [];
    for (const preset of sourcePresetDefinitions) {
      created.push(await createSourcePresetRecord(preset.id));
    }
    return created;
  }

  async function createMissingSourcePresetRecords() {
    const existingSources = await store.listSources();
    const missingPresets = sourcePresetDefinitions.filter(
      (preset) => !existingSources.some((source) => source.url === preset.url || source.name === preset.name)
    );
    const created = [];
    for (const preset of missingPresets) {
      created.push(await createSourcePresetRecord(preset.id));
    }
    return created;
  }

  async function runSource(sourceId: string, runOptions: RunSourceOptions = {}) {
    const source = await store.getSource(sourceId);
    if (!source) throw new Error(`Source not found: ${sourceId}`);
    if (!source.enabled) throw new Error(`Source is disabled: ${source.name}`);

    const beliefIds = new Set(runOptions.beliefIds?.filter(Boolean));
    const querySummary =
      (runOptions.queries ? sourceScopedQueries(runOptions.queries, source) : undefined) ??
      (sourceSupportsGeneratedQueries(source)
        ? sourceScopedQueries(
            await generateEvidenceLoopQueries({
              beliefIds: runOptions.beliefIds,
              maxQueries: runOptions.maxQueries
            }),
            source
          )
        : []);
    const startedAt = now();
    try {
      const adapter = createSourceAdapter(source.kind, options.sourceAdapterDependencies);
      const fetchedObservations = await adapter.fetch({
        name: source.name,
        adapter: source.adapter,
        url: source.url,
        credentialRef: source.credentialRef,
        queries: querySummary.map((query) => query.query)
      });
      const rawObservations = runOptions.maxObservations ? fetchedObservations.slice(0, runOptions.maxObservations) : fetchedObservations;
      let deduplicatedCount = 0;
      let candidateCount = 0;
      let autoAppliedCount = 0;
      let reviewCount = 0;
      let lowImpactCount = 0;
      let unmatchedCount = 0;
      const queriesByText = queryContextByQuery(querySummary);
      const autoApplyThreshold = normalizedThreshold(runOptions.autoConfirmThreshold, source.autoConfirmThreshold);
      const candidateThreshold = normalizedThreshold(
        runOptions.candidateThreshold,
        Math.min(autoApplyThreshold, DEFAULT_CANDIDATE_THRESHOLD)
      );
      const autoApplyPolicy = await context.applyAutoApplyPolicy({
        reviewOnly: runOptions.reviewOnly,
        autoConfirm: runOptions.forceAutoApply || source.autoConfirm,
        beliefIds: runOptions.beliefIds,
        sourceIds: [source.id]
      });
      const duplicateObservationCleanup = normalizedObservationCleanupMode(
        runOptions.duplicateObservationCleanup,
        DEFAULT_DUPLICATE_OBSERVATION_CLEANUP
      );
      const unmatchedObservationCleanup = normalizedObservationCleanupMode(
        runOptions.unmatchedObservationCleanup,
        DEFAULT_UNMATCHED_OBSERVATION_CLEANUP
      );
      const lowImpactObservationCleanup = normalizedObservationCleanupMode(
        runOptions.lowImpactObservationCleanup,
        DEFAULT_LOW_IMPACT_OBSERVATION_CLEANUP
      );

      for (const rawObservation of rawObservations) {
        const observation = await dependencies.createObservation({
          sourceId: source.id,
          title: rawObservation.title,
          content: rawObservation.content || rawObservation.title,
          url: rawObservation.url,
          author: rawObservation.author,
          publishedAt: rawObservation.publishedAt,
          credibility: source.credibility,
          metadata: observationMetadataWithQueryContext(rawObservation.sourceMetadata, queriesByText)
        });

        if (observation.status === "DUPLICATE") {
          deduplicatedCount += 1;
          await applyObservationCleanup(observation, duplicateObservationCleanup);
          continue;
        }

        const processed = await processCandidateObservation(observation, {
          candidateThreshold,
          autoApplyThreshold,
          autoConfirm: autoApplyPolicy.autoConfirm,
          reviewOnly: autoApplyPolicy.reviewOnly,
          reviewReason: autoApplyPolicy.reviewReason,
          beliefIds: beliefIds.size > 0 ? beliefIds : undefined,
          duplicateObservationCleanup,
          unmatchedObservationCleanup,
          lowImpactObservationCleanup
        });
        candidateCount += processed.candidateCount;
        autoAppliedCount += processed.autoAppliedCount;
        reviewCount += processed.reviewCount;
        lowImpactCount += processed.lowImpactCount;
        unmatchedCount += processed.unmatchedCount;
      }

      return createObservationRunRecord({
        id: createRecordId("observation_run"),
        sourceId,
        status: autoApplyPolicy.reviewOnly ? "REVIEW_ONLY" : "SUCCESS",
        startedAt,
        finishedAt: now(),
        itemCount: rawObservations.length,
        reprocessedObservationCount: 0,
        deduplicatedCount,
        candidateCount,
        autoAppliedCount,
        reviewCount,
        lowImpactCount,
        unmatchedCount,
        queryCount: querySummary.length,
        querySummary
      });
    } catch (error) {
      return createObservationRunRecord({
        id: createRecordId("observation_run"),
        sourceId,
        status: "FAILED",
        startedAt,
        finishedAt: now(),
        itemCount: 0,
        reprocessedObservationCount: 0,
        deduplicatedCount: 0,
        candidateCount: 0,
        autoAppliedCount: 0,
        reviewCount: 0,
        lowImpactCount: 0,
        unmatchedCount: 0,
        queryCount: querySummary.length,
        querySummary,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function recentSourceFailureStreak(sourceId: string) {
    const runs = (await store.listObservationRuns())
      .filter((run) => run.sourceId === sourceId)
      .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
    let consecutiveFailureCount = 0;
    let latestError: string | undefined;
    let latestFailureAt: Date | undefined;

    for (const run of runs) {
      if (run.status !== "FAILED") break;
      latestError ??= run.errorMessage;
      latestFailureAt ??= run.finishedAt ?? run.startedAt;
      consecutiveFailureCount += 1;
    }

    return { consecutiveFailureCount, latestError, latestFailureAt };
  }

  function shouldSuppressFailingSource(input: { consecutiveFailureCount: number; latestFailureAt?: Date }) {
    if (input.consecutiveFailureCount < SOURCE_FAILURE_SUPPRESSION_THRESHOLD) return false;
    if (!input.latestFailureAt) return true;
    return now().getTime() - input.latestFailureAt.getTime() < SOURCE_FAILURE_RETRY_COOLDOWN_MS;
  }

  function failureRetryAfterAt(input: { latestFailureAt?: Date }) {
    return input.latestFailureAt ? new Date(input.latestFailureAt.getTime() + SOURCE_FAILURE_RETRY_COOLDOWN_MS) : undefined;
  }

  function isDuplicateOnlyRun(run: ObservationRunRecord) {
    return (
      run.status !== "FAILED" &&
      run.itemCount > 0 &&
      run.deduplicatedCount >= run.itemCount &&
      run.candidateCount === 0 &&
      run.autoAppliedCount === 0 &&
      run.reviewCount === 0 &&
      run.lowImpactCount === 0 &&
      run.unmatchedCount === 0
    );
  }

  async function recentSourceDuplicateOnlyStreak(sourceId: string) {
    const runs = (await store.listObservationRuns())
      .filter((run) => run.sourceId === sourceId)
      .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
    let consecutiveDuplicateOnlyCount = 0;
    let latestDuplicateOnlyAt: Date | undefined;

    for (const run of runs) {
      if (!isDuplicateOnlyRun(run)) break;
      latestDuplicateOnlyAt ??= run.finishedAt ?? run.startedAt;
      consecutiveDuplicateOnlyCount += 1;
    }

    return { consecutiveDuplicateOnlyCount, latestDuplicateOnlyAt };
  }

  function shouldSuppressLowIncrementSource(input: { consecutiveDuplicateOnlyCount: number; latestDuplicateOnlyAt?: Date }) {
    if (input.consecutiveDuplicateOnlyCount < SOURCE_DUPLICATE_STALENESS_THRESHOLD) return false;
    if (!input.latestDuplicateOnlyAt) return true;
    return now().getTime() - input.latestDuplicateOnlyAt.getTime() < SOURCE_DUPLICATE_RETRY_COOLDOWN_MS;
  }

  function duplicateRetryAfterAt(input: { latestDuplicateOnlyAt?: Date }) {
    return input.latestDuplicateOnlyAt
      ? new Date(input.latestDuplicateOnlyAt.getTime() + SOURCE_DUPLICATE_RETRY_COOLDOWN_MS)
      : undefined;
  }

  async function reprocessRetryableUnmatchedObservations(loopOptions: EvidenceLoopOptions = {}) {
    const sourceIds = new Set(loopOptions.sourceIds?.filter(Boolean));
    const beliefIds = new Set(loopOptions.beliefIds?.filter(Boolean));
    const scopedBeliefs: BeliefRecord[] = [];
    const scopedHypothesisIds = new Set<string>();
    if (beliefIds.size > 0) {
      for (const belief of await store.listBeliefs()) {
        if (!beliefIds.has(belief.id)) continue;
        scopedBeliefs.push(belief);
        for (const hypothesis of belief.hypotheses) scopedHypothesisIds.add(hypothesis.id);
      }
    }
    const observations = (await store.listObservations())
      .flatMap((observation) => {
        const matchesSourceScope = sourceIds.size === 0 || (observation.sourceId ? sourceIds.has(observation.sourceId) : false);
        const recommendedLinks = recommendedLinksFromMetadata(observation.metadata);
        const matchesBeliefScope =
          beliefIds.size === 0 || (recommendedLinks.length > 0 && recommendedLinks.every((link) => scopedHypothesisIds.has(link.hypothesisId)));
        const hasRecommendedLinks = observation.status === "PENDING" && recommendedLinks.length > 0;
        const hasLowImpactRecommendedLinks =
          observation.status === "UNKNOWN" &&
          observation.metadata.ignoredReason === "LOW_IMPACT" &&
          recommendedLinks.length > 0;
        const hasRetryableUnmatchedEvaluation =
          observation.status === "UNKNOWN" &&
          observation.metadata.ignoredReason === "UNMATCHED" &&
          hasRetryableLlmCandidateEvaluation(observation.metadata);
        const retryableScopeScore = hasRetryableUnmatchedEvaluation
          ? retryableUnmatchedBeliefScopeScore(observation, scopedBeliefs)
          : 0;

        if (!matchesSourceScope) return [];
        if (matchesBeliefScope && hasRecommendedLinks) return [{ observation, scopeScore: 1 }];
        if (matchesBeliefScope && hasLowImpactRecommendedLinks) return [{ observation, scopeScore: 0.75 }];
        if (hasRetryableUnmatchedEvaluation && retryableScopeScore > 0) return [{ observation, scopeScore: retryableScopeScore }];
        return [];
      })
      .sort((left, right) => right.scopeScore - left.scopeScore || left.observation.observedAt.getTime() - right.observation.observedAt.getTime())
      .map((item) => item.observation);
    const selected = loopOptions.maxObservations ? observations.slice(0, loopOptions.maxObservations) : observations;
    const total = emptyCandidateProcessingResult();
    const duplicateObservationCleanup = normalizedObservationCleanupMode(
      loopOptions.duplicateObservationCleanup,
      DEFAULT_DUPLICATE_OBSERVATION_CLEANUP
    );
    const unmatchedObservationCleanup = normalizedObservationCleanupMode(
      loopOptions.unmatchedObservationCleanup,
      DEFAULT_UNMATCHED_OBSERVATION_CLEANUP
    );
    const lowImpactObservationCleanup = normalizedObservationCleanupMode(
      loopOptions.lowImpactObservationCleanup,
      DEFAULT_LOW_IMPACT_OBSERVATION_CLEANUP
    );

    for (const observation of selected) {
      const source = observation.sourceId ? await store.getSource(observation.sourceId) : null;
      const autoApplyThreshold = normalizedThreshold(loopOptions.autoConfirmThreshold, source?.autoConfirmThreshold ?? 0.8);
      const candidateThreshold = normalizedThreshold(
        loopOptions.candidateThreshold,
        Math.min(autoApplyThreshold, DEFAULT_CANDIDATE_THRESHOLD)
      );
      const autoApplyPolicy = await context.applyAutoApplyPolicy({
        reviewOnly: loopOptions.reviewOnly,
        autoConfirm: Boolean(loopOptions.forceAutoApply || source?.autoConfirm),
        beliefIds: loopOptions.beliefIds,
        sourceIds: source?.id ? [source.id] : undefined
      });
      const processingOptions = {
        candidateThreshold,
        autoApplyThreshold,
        autoConfirm: autoApplyPolicy.autoConfirm,
        reviewOnly: autoApplyPolicy.reviewOnly,
        reviewReason: autoApplyPolicy.reviewReason,
        beliefIds: beliefIds.size > 0 ? beliefIds : undefined,
        duplicateObservationCleanup,
        unmatchedObservationCleanup,
        lowImpactObservationCleanup
      };
      const processed =
        await (async () => {
          try {
            return observation.status === "PENDING" && recommendedLinksFromMetadata(observation.metadata).length > 0
              ? await processQueuedRecommendedObservation(observation, processingOptions)
              : await processCandidateObservation(observation, processingOptions);
          } catch (error) {
            return {
              ...emptyCandidateProcessingResult(),
              failureCount: 1,
              errorMessages: [error instanceof Error ? error.message : String(error)]
            };
          }
        })();
      addCandidateProcessingResult(total, processed);
    }

    return {
      ...total,
      reprocessedObservationCount: selected.length
    };
  }

  function retryableUnmatchedBeliefScopeScore(observation: ObservationRecord, scopedBeliefs: BeliefRecord[]) {
    if (scopedBeliefs.length === 0) return 1;

    const signal = observationSignalText(observation);
    const queryHint = observationQueryHint(observation);
    let best = 0;
    for (const belief of scopedBeliefs) {
      best = Math.max(best, overlapScore(signal, `${belief.title} ${belief.description}`));
      for (const hypothesis of belief.hypotheses.filter((item) => isCurrentlyEffectiveHypothesis(item))) {
        best = Math.max(
          best,
          overlapScore(signal, `${belief.title} ${hypothesis.proposition} ${hypothesis.notes} ${hypothesis.evidenceSearchQuery ?? ""}`),
          queryHintScore(queryHint, belief, hypothesis)
        );
      }
    }

    return best >= OBSERVATION_RECOMMENDATION_THRESHOLD ? best : 0;
  }

  async function runEvidenceLoop(loopOptions: EvidenceLoopOptions = {}) {
    const queries = await generateEvidenceLoopQueries(loopOptions);
    const reprocessedStartedAt = now();
    const reprocessed = await reprocessRetryableUnmatchedObservations(loopOptions);
    const runs: ObservationRunRecord[] = [];
    const buildLoopResult = (loopRuns: ObservationRunRecord[], skippedSources: EvidenceLoopSkippedSource[] = []) => ({
      mode: evidenceLoopResultMode(loopOptions, loopRuns),
      queryCount: queries.length,
      sourceRunCount: loopRuns.filter((run) => Boolean(run.sourceId)).length,
      skippedSourceCount: skippedSources.length,
      skippedSources,
      itemCount: loopRuns.reduce((sum, run) => sum + run.itemCount, 0),
      reprocessedObservationCount: loopRuns.reduce((sum, run) => sum + run.reprocessedObservationCount, 0),
      deduplicatedCount: loopRuns.reduce((sum, run) => sum + run.deduplicatedCount, 0),
      candidateCount: loopRuns.reduce((sum, run) => sum + run.candidateCount, 0),
      autoAppliedCount: loopRuns.reduce((sum, run) => sum + run.autoAppliedCount, 0),
      reviewCount: loopRuns.reduce((sum, run) => sum + run.reviewCount, 0),
      lowImpactCount: loopRuns.reduce((sum, run) => sum + run.lowImpactCount, 0),
      unmatchedCount: loopRuns.reduce((sum, run) => sum + run.unmatchedCount, 0),
      failureCount: loopRuns.filter((run) => run.status === "FAILED").length,
      queries,
      runs: loopRuns
    });

    if (reprocessed.reprocessedObservationCount > 0) {
      runs.push(
        await createObservationRunRecord({
          id: createRecordId("observation_run"),
          sourceId: undefined,
          status: reprocessed.failureCount > 0 ? "FAILED" : loopOptions.reviewOnly ? "REVIEW_ONLY" : "SUCCESS",
          startedAt: reprocessedStartedAt,
          finishedAt: now(),
          itemCount: 0,
          reprocessedObservationCount: reprocessed.reprocessedObservationCount,
          deduplicatedCount: 0,
          candidateCount: reprocessed.candidateCount,
          autoAppliedCount: reprocessed.autoAppliedCount,
          reviewCount: reprocessed.reviewCount,
          lowImpactCount: reprocessed.lowImpactCount,
          unmatchedCount: reprocessed.unmatchedCount,
          queryCount: queries.length,
          querySummary: queries,
          errorMessage: reprocessed.errorMessages.join("；") || undefined
        })
      );
    }

    if (queries.length === 0) {
      if (runs.length === 0) {
        const noQueryStartedAt = now();
        runs.push(
          await createObservationRunRecord({
            id: createRecordId("observation_run"),
            sourceId: undefined,
            status: "FAILED",
            startedAt: noQueryStartedAt,
            finishedAt: now(),
            itemCount: 0,
            reprocessedObservationCount: 0,
            deduplicatedCount: 0,
            candidateCount: 0,
            autoAppliedCount: 0,
            reviewCount: 0,
            lowImpactCount: 0,
            unmatchedCount: 0,
            queryCount: 0,
            querySummary: [],
            errorMessage: noRunnableQueryDiagnosticMessage()
          })
        );
      }

      return buildLoopResult(runs);
    }
    const sourceIds = new Set(loopOptions.sourceIds?.filter(Boolean));
    if (loopOptions.bootstrapDefaultSources && sourceIds.size === 0) {
      await bootstrapDefaultSources();
    }
    const allSources = await store.listSources();
    const sourceCodes = createReadableCodes(allSources, "S", (source) => source.createdAt);
    const sourceCode = (sourceId: string) => readableCode(sourceCodes, sourceId, "S");
    const eligibleSources = allSources.filter((source) => {
      if (!source.enabled || source.kind === "MANUAL") return false;
      return sourceIds.size === 0 || sourceIds.has(source.id);
    });
    let sources = eligibleSources;
    const skippedSources: EvidenceLoopSkippedSource[] = [];
    if (sourceIds.size === 0) {
      const stableSources: Array<{
        source: (typeof eligibleSources)[number];
        consecutiveFailureCount: number;
        consecutiveDuplicateOnlyCount: number;
        order: number;
      }> = [];
      for (const [order, source] of eligibleSources.entries()) {
        const failureStreak = await recentSourceFailureStreak(source.id);
        if (shouldSuppressFailingSource(failureStreak)) {
          skippedSources.push({
            sourceId: source.id,
            sourceCode: sourceCode(source.id),
            sourceName: source.name,
            reason: "CONSECUTIVE_FAILURES",
            consecutiveFailureCount: failureStreak.consecutiveFailureCount,
            latestError: failureStreak.latestError,
            retryAfterAt: failureRetryAfterAt(failureStreak)
          });
          continue;
        }

        const duplicateOnlyStreak = await recentSourceDuplicateOnlyStreak(source.id);
        if (shouldSuppressLowIncrementSource(duplicateOnlyStreak)) {
          skippedSources.push({
            sourceId: source.id,
            sourceCode: sourceCode(source.id),
            sourceName: source.name,
            reason: "LOW_INCREMENT",
            consecutiveDuplicateOnlyCount: duplicateOnlyStreak.consecutiveDuplicateOnlyCount,
            retryAfterAt: duplicateRetryAfterAt(duplicateOnlyStreak)
          });
          continue;
        }

        stableSources.push({
          source,
          consecutiveFailureCount: failureStreak.consecutiveFailureCount,
          consecutiveDuplicateOnlyCount: duplicateOnlyStreak.consecutiveDuplicateOnlyCount,
          order
        });
      }
      sources = stableSources
        .sort(
          (left, right) =>
            left.consecutiveFailureCount - right.consecutiveFailureCount ||
            left.consecutiveDuplicateOnlyCount - right.consecutiveDuplicateOnlyCount ||
            left.order - right.order
        )
        .map((item) => item.source);
    }
    if (loopOptions.maxSources !== undefined && loopOptions.maxSources > 0) {
      sources = sources.slice(0, Math.floor(loopOptions.maxSources));
    }

    for (const source of sources) {
      const run = await runSource(source.id, {
        reviewOnly: loopOptions.reviewOnly,
        candidateThreshold: loopOptions.candidateThreshold,
        autoConfirmThreshold: loopOptions.autoConfirmThreshold,
        maxObservations: loopOptions.maxObservations,
        forceAutoApply: loopOptions.forceAutoApply,
        beliefIds: loopOptions.beliefIds,
        queries,
        duplicateObservationCleanup: loopOptions.duplicateObservationCleanup,
        unmatchedObservationCleanup: loopOptions.unmatchedObservationCleanup,
        lowImpactObservationCleanup: loopOptions.lowImpactObservationCleanup
      });
      runs.push({ ...run, sourceCode: sourceCode(source.id) });
    }

    if (runs.length === 0 && skippedSources.length > 0) {
      const skippedStartedAt = now();
      runs.push(
        await createObservationRunRecord({
          id: createRecordId("observation_run"),
          sourceId: undefined,
          status: "FAILED",
          startedAt: skippedStartedAt,
          finishedAt: now(),
          itemCount: 0,
          reprocessedObservationCount: 0,
          deduplicatedCount: 0,
          candidateCount: 0,
          autoAppliedCount: 0,
          reviewCount: 0,
          lowImpactCount: 0,
          unmatchedCount: 0,
          queryCount: queries.length,
          querySummary: queries,
          errorMessage: skippedSourceDiagnosticMessage(skippedSources)
        })
      );
    }

    if (runs.length === 0 && skippedSources.length === 0 && queries.length > 0 && sources.length === 0) {
      const noSourceStartedAt = now();
      runs.push(
        await createObservationRunRecord({
          id: createRecordId("observation_run"),
          sourceId: undefined,
          status: "FAILED",
          startedAt: noSourceStartedAt,
          finishedAt: now(),
          itemCount: 0,
          reprocessedObservationCount: 0,
          deduplicatedCount: 0,
          candidateCount: 0,
          autoAppliedCount: 0,
          reviewCount: 0,
          lowImpactCount: 0,
          unmatchedCount: 0,
          queryCount: queries.length,
          querySummary: queries,
          errorMessage: noRunnableSourceDiagnosticMessage(allSources, sourceIds)
        })
      );
    }

    return buildLoopResult(runs, skippedSources);
  }

  return {
    recommendedEvidenceLinks,
    runSource,
    runEvidenceLoop,
    generateEvidenceLoopQueries,
    createSourcePresetRecord,
    createMissingSourcePresetRecords,
    requeueUnmatchedObservationsForHypothesis,
    requeueSourceObservationForRecommendedHypotheses,
    requeueSourceObservationForRecommendedHypothesis
  };
}
