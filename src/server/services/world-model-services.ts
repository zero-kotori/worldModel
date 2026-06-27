import { deduplicateObservation, type ObservationForDedupe } from "@/domain/dedupe";
import { combineEstimatorOutputs } from "@/domain/likelihood";
import {
  applyUpdate,
  createUpdatePreview,
  rollbackUpdate,
  type BeliefForUpdate,
  type EvidenceLinkForUpdate,
  type UpdatePreview
} from "@/domain/updates";
import { normalizeMutuallyExclusive } from "@/domain/bayes";
import type { EstimatorOutput } from "@/domain/likelihood";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import { getSourcePreset, listSourcePresets, sourcePresetDefinitions } from "@/lib/world-model-source-presets";
import type { LikelihoodEstimator } from "@/server/models/estimators";
import { createRecordId } from "@/server/services/in-memory-store";
import { createSourceAdapter, type AdapterDependencies } from "@/server/sources/adapters";
import type {
  AutomationHeartbeatRecord,
  AutomationWorkerConfigRecord,
  BayesianUpdateEventRecord,
  ConfirmAndApplyEvidenceResult,
  ConfirmEvidenceInput,
  CreateBeliefInput,
  CreateHypothesisInput,
  CreateObservationInput,
  CreateSourceInput,
  EvidenceHypothesisLinkRecord,
  EvidenceLoopOptions,
  EvidenceLoopQuery,
  EvidenceLoopSkippedSource,
  EvidenceRecord,
  HypothesisRecommendation,
  HypothesisRecommendationGenerator,
  HypothesisRecommendationOptions,
  HypothesisRecord,
  ImportArtifactInput,
  ObservationRecord,
  ObservationRunRecord,
  ObservationSourceRecord,
  RawObservationInput,
  RunDryRunOptions,
  RunSourceOptions,
  RunLikelihoodInput,
  ConnectEvidenceHypothesisInput,
  DisconnectEvidenceHypothesisInput,
  SettleObservationInput,
  BeliefRecord,
  UpdateBeliefInput,
  UpdateEvidenceInput,
  UpdateHypothesisInput,
  UpdateObservationInput,
  UpdateSourceInput,
  WorldModelServices,
  WorldModelStore
} from "@/server/services/types";
import {
  artifactSchema,
  automationHeartbeatSchema,
  automationWorkerConfigSchema,
  confirmEvidenceSchema,
  connectEvidenceHypothesisSchema,
  createHypothesisSchema,
  createObservationSchema,
  disconnectEvidenceHypothesisSchema,
  evidenceLinksSchema,
  parseBeliefInput,
  sourceSchema,
  updateBeliefSchema,
  updateEvidenceSchema,
  updateHypothesisSchema,
  updateObservationSchema,
  updateSourceSchema
} from "@/server/services/internal/schemas";

const DEFAULT_CANDIDATE_THRESHOLD = 0.25;
const DEFAULT_MIN_CANDIDATE_PROBABILITY_DELTA = 0.01;
const OBSERVATION_RECOMMENDATION_THRESHOLD = 0.2;
const LLM_FALLBACK_CANDIDATE_LIMIT = 5;
const SOURCE_FAILURE_SUPPRESSION_THRESHOLD = 3;
const SOURCE_FAILURE_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const SOURCE_DUPLICATE_STALENESS_THRESHOLD = 3;
const SOURCE_DUPLICATE_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_QUERY_TEMPLATE_SOURCE_KINDS = new Set(["GITHUB", "HUGGING_FACE", "GDELT", "PREDICTION_MARKET"]);
const CALIBRATION_QUERY_ERROR_THRESHOLD = 0.35;
const CALIBRATION_QUERY_PRIORITY_WEIGHT = 0.2;
const COUNTER_EVIDENCE_QUERY_PROBABILITY_THRESHOLD = 0.8;
const COUNTER_EVIDENCE_QUERY_PRIORITY_BOOST = 0.75;
const STALE_EVIDENCE_QUERY_DAYS = 30;
const STALE_EVIDENCE_QUERY_PRIORITY_BOOST = 0.6;
const FRAGILE_CERTAINTY_QUERY_PROBABILITY_THRESHOLD = 0.85;
const FRAGILE_CERTAINTY_QUERY_QUALITY_THRESHOLD = 0.55;
const FRAGILE_CERTAINTY_QUERY_PRIORITY_BOOST = 0.7;
const DAY_MS = 24 * 60 * 60 * 1000;

type CandidateEvaluationMetadata = {
  estimator: string;
  attemptedCount: number;
  usableCount: number;
  abstainedCount: number;
  rejectedCount: number;
  latestRationale?: string;
};

type EvidenceLinkRecommendationResult = {
  links: ConfirmEvidenceInput["links"];
  candidateEvaluation?: CandidateEvaluationMetadata;
};

type EvidenceLinkRecommendationOptions = {
  beliefIds?: ReadonlySet<string>;
};

type CandidateObservationProcessingOptions = {
  candidateThreshold: number;
  autoApplyThreshold: number;
  autoConfirm: boolean;
  reviewOnly?: boolean;
  reviewReason?: string;
  beliefIds?: ReadonlySet<string>;
};

type CandidateObservationProcessingResult = {
  candidateCount: number;
  autoAppliedCount: number;
  reviewCount: number;
  lowImpactCount: number;
  unmatchedCount: number;
  failureCount: number;
  errorMessages: string[];
};

function now() {
  return new Date();
}

function isCurrentlyEffectiveHypothesis(hypothesis: HypothesisRecord, referenceTime = now()) {
  if (hypothesis.status !== "ACTIVE") return false;
  const referenceMs = referenceTime.getTime();
  if (hypothesis.startsAt && hypothesis.startsAt.getTime() > referenceMs) return false;
  if (hypothesis.expiresAt && hypothesis.expiresAt.getTime() <= referenceMs) return false;
  return true;
}

function isSettlementReviewDueHypothesis(hypothesis: HypothesisRecord, referenceTime = now()) {
  if (hypothesis.status !== "ACTIVE" || !hypothesis.expiresAt) return false;
  return hypothesis.expiresAt.getTime() <= referenceTime.getTime();
}

function createHypotheses(input: CreateBeliefInput, beliefId: string): HypothesisRecord[] {
  const priorProbabilities =
    input.probabilityMode === "MUTUALLY_EXCLUSIVE"
      ? normalizeMutuallyExclusive(input.hypotheses.map((hypothesis) => hypothesis.priorProbability))
      : input.hypotheses.map((hypothesis) => hypothesis.priorProbability);
  const currentProbabilityInputs = input.hypotheses.map((hypothesis) => hypothesis.currentProbability ?? hypothesis.priorProbability);
  const currentProbabilities =
    input.probabilityMode === "MUTUALLY_EXCLUSIVE" ? normalizeMutuallyExclusive(currentProbabilityInputs) : currentProbabilityInputs;
  const createdAt = now();

  return input.hypotheses.map((hypothesis, index) => ({
    id: createRecordId("hypothesis"),
    beliefId,
    proposition: hypothesis.proposition.trim(),
    notes: hypothesis.notes ?? "",
    evidenceSearchQuery: hypothesis.evidenceSearchQuery?.trim() ?? "",
    stance: hypothesis.stance ?? "SUPPORTS",
    priorProbability: priorProbabilities[index],
    currentProbability: currentProbabilities[index],
    strength: currentProbabilities[index],
    status: "ACTIVE",
    startsAt: hypothesis.startsAt,
    expiresAt: hypothesis.expiresAt,
    expiryCondition: hypothesis.expiryCondition,
    createdAt,
    updatedAt: createdAt
  }));
}

function evidenceLinkToPreviewLink(link: EvidenceHypothesisLinkRecord, credibility: number): EvidenceLinkForUpdate {
  return {
    hypothesisId: link.hypothesisId,
    likelihoodRatio: link.likelihoodRatio,
    credibility,
    confidence: link.confidence,
    rationale: link.rationale
  };
}

async function resolveHypothesesForLinks(
  store: WorldModelStore,
  links: Array<{ hypothesisId: string }>
): Promise<HypothesisRecord[]> {
  const hypotheses = await Promise.all(links.map((link) => store.getHypothesis(link.hypothesisId)));
  const missingIndex = hypotheses.findIndex((hypothesis) => !hypothesis);
  if (missingIndex >= 0) {
    throw new Error(`Hypothesis not found: ${links[missingIndex].hypothesisId}`);
  }
  return hypotheses as HypothesisRecord[];
}

async function evidenceLinksForBelief(store: WorldModelStore, evidence: EvidenceRecord, beliefId: string) {
  const hypotheses = await resolveHypothesesForLinks(store, evidence.links);
  const hypothesisById = new Map(hypotheses.map((hypothesis) => [hypothesis.id, hypothesis] as const));
  return evidence.links.filter((link) => {
    const hypothesis = hypothesisById.get(link.hypothesisId);
    return hypothesis?.beliefId === beliefId && isCurrentlyEffectiveHypothesis(hypothesis);
  });
}

async function createEvidencePreviews(store: WorldModelStore, evidence: EvidenceRecord): Promise<UpdatePreview[]> {
  if (evidence.status !== "ACTIVE") throw new Error(`Evidence is not active and cannot be applied: ${evidence.title}`);
  const hypotheses = await resolveHypothesesForLinks(store, evidence.links);
  const hypothesisById = new Map(hypotheses.map((hypothesis) => [hypothesis.id, hypothesis] as const));
  const linksByBeliefId = new Map<string, EvidenceHypothesisLinkRecord[]>();

  for (const link of evidence.links) {
    const hypothesis = hypothesisById.get(link.hypothesisId);
    if (!hypothesis) throw new Error(`Hypothesis not found: ${link.hypothesisId}`);
    if (!isCurrentlyEffectiveHypothesis(hypothesis)) continue;
    linksByBeliefId.set(hypothesis.beliefId, [...(linksByBeliefId.get(hypothesis.beliefId) ?? []), link]);
  }

  const previews: UpdatePreview[] = [];
  for (const [beliefId, links] of linksByBeliefId) {
    const belief = await store.getBelief(beliefId);
    if (!belief) throw new Error(`Belief not found: ${beliefId}`);
    previews.push({
      ...createUpdatePreview(
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
        links.map((link) => evidenceLinkToPreviewLink(link, evidence.credibility))
      ),
      evidenceId: evidence.id
    });
  }

  return previews;
}

function baseProbabilitySnapshot(belief: BeliefRecord) {
  const probabilities =
    belief.probabilityMode === "MUTUALLY_EXCLUSIVE"
      ? normalizeMutuallyExclusive(belief.hypotheses.map((hypothesis) => hypothesis.priorProbability))
      : belief.hypotheses.map((hypothesis) => hypothesis.priorProbability);
  return Object.fromEntries(belief.hypotheses.map((hypothesis, index) => [hypothesis.id, probabilities[index]]));
}

function createBeliefForSnapshotPreview(belief: BeliefRecord, probabilities: Record<string, number>): BeliefForUpdate {
  return {
    id: belief.id,
    probabilityMode: belief.probabilityMode,
    hypotheses: belief.hypotheses.map((hypothesis) => ({
      id: hypothesis.id,
      proposition: hypothesis.proposition,
      currentProbability: probabilities[hypothesis.id] ?? hypothesis.currentProbability,
      strength: probabilities[hypothesis.id] ?? hypothesis.strength
    }))
  };
}

function toDedupeObservation(observation: RawObservationInput | CreateObservationInput): ObservationForDedupe {
  return {
    title: observation.title,
    content: observation.content,
    url: observation.url,
    observedAt: new Date(),
    publishedAt: observation.publishedAt
  };
}

export type AutoApplyPolicyInput = {
  reviewOnly?: boolean;
  autoConfirm: boolean;
  beliefIds?: string[];
  sourceIds?: string[];
  reviewReason?: string;
};

export type WorldModelServiceOptions = {
  sourceAdapterDependencies?: AdapterDependencies;
  likelihoodEstimator?: LikelihoodEstimator;
  hypothesisRecommendationGenerator?: HypothesisRecommendationGenerator;
  autoApplyPolicy?: (input: AutoApplyPolicyInput) => AutoApplyPolicyInput | Promise<AutoApplyPolicyInput>;
};

function textTokens(value: string) {
  const normalized = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .trim();
  if (!normalized) return new Set<string>();
  return new Set(normalized.split(/\s+/).filter((token) => token.length >= 2));
}

function overlapScore(source: string, target: string) {
  const sourceTokens = textTokens(source);
  const targetTokens = textTokens(target);
  if (sourceTokens.size === 0 || targetTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of targetTokens) {
    if (sourceTokens.has(token)) overlap += 1;
  }
  return overlap / targetTokens.size;
}

function normalizedThreshold(value: number | undefined, fallback: number) {
  const threshold = value ?? fallback;
  if (!Number.isFinite(threshold)) return fallback;
  return Math.min(1, Math.max(0, threshold));
}

function sourceSupportsGeneratedQueries(source: Pick<ObservationSourceRecord, "kind" | "url">) {
  return Boolean(source.url?.includes("{query}") || DEFAULT_QUERY_TEMPLATE_SOURCE_KINDS.has(source.kind));
}

function metadataText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
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
  delete next.ignoredReason;
  delete next.candidateEvaluation;
  delete next.recommendedLinks;
  delete next.reviewReason;
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

function hasDemoArtifactMarker(value: unknown) {
  return typeof value === "string" && /(^|[^a-z0-9])demo([^a-z0-9]|$)/i.test(value);
}

function modelArtifactSampleCount(metrics: Record<string, unknown>) {
  const value = metrics.sampleCount;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function modelArtifactExplicitlyUntrained(metrics: Record<string, unknown>) {
  return metrics.trained === false;
}

function assertImportableModelArtifact(input: ImportArtifactInput) {
  if (hasDemoArtifactMarker(input.name) || hasDemoArtifactMarker(input.path)) {
    throw new Error("Demo model artifacts cannot be imported as real likelihood models.");
  }

  if (input.kind !== "LIGHTWEIGHT") return;
  if (modelArtifactExplicitlyUntrained(input.metrics)) {
    throw new Error("Untrained lightweight model artifacts cannot be imported.");
  }
  const sampleCount = modelArtifactSampleCount(input.metrics);
  if (sampleCount === null || sampleCount <= 0) {
    throw new Error("Lightweight model artifacts must report real training samples with metrics.sampleCount greater than 0.");
  }
}

function normalizedTextKey(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9\u4e00-\u9fa5]+/g, "");
}

function categoryRecommendationTemplates(category: CreateBeliefInput["category"]) {
  const shared = [
    {
      stance: "SUPPORTS" as const,
      priorProbability: 0.45,
      proposition: (title: string) => `${title} 在未来 6-12 个月出现可重复的正向证据`,
      rationale: "建立一个短周期正向检验点，避免只停留在长期直觉。",
      notes: "可观察：至少 3 个可信来源给出方向一致的进展、采用或结果数据。"
    },
    {
      stance: "OPPOSES" as const,
      priorProbability: 0.35,
      proposition: (title: string) => `${title} 的关键反例在未来 6-12 个月持续出现`,
      rationale: "保留反证假设，避免只收集支持性证据。",
      notes: "可观察：高可信来源持续出现失败案例、负面结果、停滞指标或替代解释。"
    }
  ];

  const specific: Record<CreateBeliefInput["category"], typeof shared> = {
    AI_TREND: [
      {
        stance: "SUPPORTS",
        priorProbability: 0.5,
        proposition: (title) => `${title} 带来真实工作流中的效率或质量提升`,
        rationale: "AI 趋势需要落到真实任务结果，而不是只看发布热度。",
        notes: "可观察：企业案例、基准复现、用户留存或交付周期数据显示持续改善。"
      },
      {
        stance: "OPPOSES",
        priorProbability: 0.35,
        proposition: (title) => `${title} 被评审成本、可靠性或集成复杂度抵消`,
        rationale: "反向检验采用阻力，防止高估演示效果。",
        notes: "可观察：失败复盘、成本上升、人工返工、可靠性事故或弃用信号。"
      }
    ],
    INVESTMENT: [
      {
        stance: "SUPPORTS",
        priorProbability: 0.45,
        proposition: (title) => `${title} 的基本面或资金面指标持续改善`,
        rationale: "投资判断需要拆成可跟踪的驱动因素。",
        notes: "可观察：财报、订单、现金流、估值、资金流或行业数据连续改善。"
      },
      {
        stance: "OPPOSES",
        priorProbability: 0.4,
        proposition: (title) => `${title} 的核心驱动被估值、周期或竞争压力削弱`,
        rationale: "明确反向风险，避免单边叙事。",
        notes: "可观察：利润率恶化、估值压缩、监管变化、竞争加剧或需求下滑。"
      }
    ],
    TECH_TREND: [
      {
        stance: "SUPPORTS",
        priorProbability: 0.45,
        proposition: (title) => `${title} 获得开发者、企业或生态的持续采用`,
        rationale: "技术趋势要看采用和生态，而不只是概念热度。",
        notes: "可观察：GitHub、下载量、客户案例、标准化进展或生态工具增长。"
      },
      {
        stance: "OPPOSES",
        priorProbability: 0.35,
        proposition: (title) => `${title} 因迁移成本、性能或生态缺口停留在小众场景`,
        rationale: "技术采用常被切换成本和生态约束限制。",
        notes: "可观察：迁移失败、性能瓶颈、维护停滞、社区活跃下降或替代方案胜出。"
      }
    ],
    CAREER: [
      {
        stance: "SUPPORTS",
        priorProbability: 0.45,
        proposition: (title) => `${title} 提升长期能力、机会质量或选择权`,
        rationale: "职业判断要拆成能力、机会和选择权三个可追踪维度。",
        notes: "可观察：岗位要求、薪酬区间、项目产出、人脉质量或学习曲线改善。"
      },
      {
        stance: "OPPOSES",
        priorProbability: 0.35,
        proposition: (title) => `${title} 的机会成本高于实际收益`,
        rationale: "保留机会成本假设，避免只看路径收益。",
        notes: "可观察：收入差距、时间投入、压力水平、技能折旧或替代路径表现更好。"
      }
    ],
    SOURCE_RELIABILITY: [
      {
        stance: "SUPPORTS",
        priorProbability: 0.55,
        proposition: (title) => `${title} 在关键事实上持续被后续证据验证`,
        rationale: "来源可靠性应由历史命中率和修正透明度检验。",
        notes: "可观察：原始证据、后续验证、勘误记录、引用链和过往预测准确率。"
      },
      {
        stance: "OPPOSES",
        priorProbability: 0.35,
        proposition: (title) => `${title} 存在选择性报道、误导性归因或低质量引用`,
        rationale: "可靠性判断必须持续寻找系统性偏差。",
        notes: "可观察：断章取义、缺少一手来源、反复误报、利益冲突或回避更正。"
      }
    ]
  };

  return [...specific[category], ...shared];
}

function observationSignalText(observation: ObservationRecord) {
  return [observation.title, observation.content].filter(Boolean).join(" ");
}

function compactObservationTitle(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (normalized.length <= 96) return normalized;
  return `${normalized.slice(0, 94)}...`;
}

function observationDrivenStance(observation: ObservationRecord): HypothesisRecord["stance"] {
  const signal = observationSignalText(observation);
  if (/(delay|slow|risk|fail|cost|overhead|decline|drop|weak|阻力|延迟|放缓|风险|失败|成本|下降|削弱)/i.test(signal)) {
    return "OPPOSES";
  }
  return "SUPPORTS";
}

function resolvedOutcomeValue(status: HypothesisRecord["status"]): 0 | 1 | null {
  if (status === "RESOLVED_TRUE") return 1;
  if (status === "RESOLVED_FALSE") return 0;
  return null;
}

function createCalibrationRepairRecommendations(
  belief: BeliefRecord,
  seen: Set<string>,
  limit: number
): Array<{
  hypothesis: HypothesisRecord;
  outcome: 0 | 1;
  predictedProbability: number;
  error: number;
  fallback: HypothesisRecommendation;
}> {
  return belief.hypotheses
    .flatMap((hypothesis) => {
      const outcome = resolvedOutcomeValue(hypothesis.status);
      if (outcome === null) return [];

      const predictedProbability = Math.min(1, Math.max(0, hypothesis.currentProbability));
      const error = Math.abs(predictedProbability - outcome);
      if (error < CALIBRATION_QUERY_ERROR_THRESHOLD) return [];

      const stance: HypothesisRecord["stance"] = outcome === 0 ? "OPPOSES" : "SUPPORTS";
      const proposition =
        outcome === 0
          ? `导致「${hypothesis.proposition}」被证伪的条件仍可能复现`
          : `导致「${hypothesis.proposition}」最终成立的领先信号仍可能复现`;
      const key = normalizedTextKey(proposition);
      if (!proposition || seen.has(key)) return [];
      seen.add(key);

      const outcomeLabel = outcome === 0 ? "未发生" : "发生";
      const resolvedOutcome = hypothesis.resolvedOutcome?.trim();
      const fallback = {
        proposition,
        stance,
        priorProbability: stance === "OPPOSES" ? 0.35 : 0.45,
        notes: `可观察：复盘已结算假设的误判条件、领先信号和反证来源。${resolvedOutcome ? `结算记录：${resolvedOutcome}` : ""}`.trim(),
        evidenceSearchQuery: `${belief.title} ${hypothesis.proposition} ${resolvedOutcome ?? ""}`.trim(),
        rationale: `校准偏差：${hypothesis.proposition} 结算为${outcomeLabel}，结算概率 ${(predictedProbability * 100).toFixed(
          1
        )}%，误差 ${(error * 100).toFixed(1)}pp。`,
        calibrationHypothesisId: hypothesis.id,
        calibrationError: Number(error.toFixed(3))
      } satisfies HypothesisRecommendation;
      return [
        {
          hypothesis,
          outcome,
          predictedProbability,
          error,
          fallback
        }
      ];
    })
    .sort((left, right) => right.error - left.error || left.fallback.proposition.localeCompare(right.fallback.proposition))
    .slice(0, limit);
}

function addRecommendationIfUsable(
  recommendations: HypothesisRecommendation[],
  seen: Set<string>,
  recommendation: HypothesisRecommendation,
  fallback: HypothesisRecommendation,
  limit: number
) {
  if (recommendations.length >= limit) return false;
  const proposition = recommendation.proposition.trim();
  const key = normalizedTextKey(proposition);
  if (!proposition || seen.has(key)) return false;
  if (recommendation.stance !== "SUPPORTS" && recommendation.stance !== "OPPOSES") return false;
  if (!Number.isFinite(recommendation.priorProbability)) return false;

  seen.add(key);
  recommendations.push({
    proposition,
    stance: recommendation.stance,
    priorProbability: Math.min(0.95, Math.max(0.05, recommendation.priorProbability)),
    notes: recommendation.notes.trim() || fallback.notes,
    evidenceSearchQuery: recommendation.evidenceSearchQuery.trim() || fallback.evidenceSearchQuery,
    rationale: recommendation.rationale.trim() || fallback.rationale,
    sourceObservationId: recommendation.sourceObservationId ?? fallback.sourceObservationId,
    calibrationHypothesisId: fallback.calibrationHypothesisId,
    calibrationError: fallback.calibrationError
  });
  return true;
}

async function createCalibrationRepairRecommendationList(
  belief: BeliefRecord,
  seen: Set<string>,
  limit: number,
  generator?: HypothesisRecommendationGenerator
): Promise<HypothesisRecommendation[]> {
  const contexts = createCalibrationRepairRecommendations(belief, new Set(seen), limit);
  const recommendations: HypothesisRecommendation[] = [];

  for (const context of contexts) {
    const generated =
      generator && recommendations.length < limit
        ? await generator({
            belief,
            calibration: {
              hypothesis: context.hypothesis,
              outcome: context.outcome,
              predictedProbability: context.predictedProbability,
              error: context.error,
              resolvedOutcome: context.hypothesis.resolvedOutcome
            },
            limit: limit - recommendations.length
          }).catch(() => [])
        : [];

    for (const recommendation of generated) {
      addRecommendationIfUsable(recommendations, seen, recommendation, context.fallback, limit);
    }
    addRecommendationIfUsable(recommendations, seen, context.fallback, context.fallback, limit);
    if (recommendations.length >= limit) break;
  }

  return recommendations;
}

function createObservationDrivenRecommendationContexts(
  belief: BeliefRecord,
  observations: ObservationRecord[],
  seen: Set<string>,
  limit: number
): Array<{ observation: ObservationRecord; fallback: HypothesisRecommendation }> {
  const context = [belief.title, belief.description].filter(Boolean).join(" ");
  return observations
    .filter(
      (observation) =>
        observation.metadata.ignoredReason === "UNMATCHED" &&
        observation.status !== "CONFIRMED" &&
        observation.status !== "REJECTED" &&
        observation.status !== "DUPLICATE"
    )
    .map((observation) => ({
      observation,
      score: overlapScore(observationSignalText(observation), context)
    }))
    .filter((item) => item.score >= OBSERVATION_RECOMMENDATION_THRESHOLD)
    .sort((a, b) => b.score - a.score || b.observation.observedAt.getTime() - a.observation.observedAt.getTime())
    .flatMap((item) => {
      const observationTitle = compactObservationTitle(item.observation.title);
      const stance = observationDrivenStance(item.observation);
      const proposition = `${observationTitle} 持续影响「${belief.title}」`;
      const key = normalizedTextKey(proposition);
      if (!observationTitle || seen.has(key)) return [];
      seen.add(key);
      const fallback = {
        proposition,
        stance,
        priorProbability: stance === "OPPOSES" ? 0.35 : 0.45,
        notes: `可观察：跟踪这条未匹配观察是否被更多来源复现、量化或反驳。来源观察：${observationTitle}`,
        evidenceSearchQuery: `${belief.title} ${observationTitle}`.trim(),
        rationale: `来自未匹配观察：${observationTitle}`,
        sourceObservationId: item.observation.id
      } satisfies HypothesisRecommendation;
      return [
        {
          observation: item.observation,
          fallback
        }
      ];
    })
    .slice(0, limit);
}

async function createObservationDrivenRecommendationList(
  belief: BeliefRecord,
  observations: ObservationRecord[],
  seen: Set<string>,
  limit: number,
  generator?: HypothesisRecommendationGenerator
): Promise<HypothesisRecommendation[]> {
  const contexts = createObservationDrivenRecommendationContexts(belief, observations, new Set(seen), limit);
  const recommendations: HypothesisRecommendation[] = [];

  for (const context of contexts) {
    const generated =
      generator && recommendations.length < limit
        ? await generator({
            belief,
            sourceObservation: context.observation,
            limit: limit - recommendations.length
          }).catch(() => [])
        : [];

    for (const recommendation of generated) {
      addRecommendationIfUsable(recommendations, seen, recommendation, context.fallback, limit);
    }
    addRecommendationIfUsable(recommendations, seen, context.fallback, context.fallback, limit);
    if (recommendations.length >= limit) break;
  }

  return recommendations;
}

async function createHypothesisRecommendations(
  belief: BeliefRecord,
  options: HypothesisRecommendationOptions = {},
  observations: ObservationRecord[] = [],
  generator?: HypothesisRecommendationGenerator
): Promise<HypothesisRecommendation[]> {
  const limit = Math.max(1, Math.min(8, options.limit ?? 4));
  const existing = new Set(belief.hypotheses.map((hypothesis) => normalizedTextKey(hypothesis.proposition)));
  const seen = new Set(existing);
  const title = belief.title.trim();
  const context = [belief.title, belief.description].filter(Boolean).join(" ");
  const templates = categoryRecommendationTemplates(belief.category);
  const recommendations: HypothesisRecommendation[] = await createCalibrationRepairRecommendationList(belief, seen, limit, generator);
  recommendations.push(
    ...(await createObservationDrivenRecommendationList(belief, observations, seen, limit - recommendations.length, generator))
  );
  if (options.sourceObservationId) {
    return recommendations.filter((recommendation) => recommendation.sourceObservationId === options.sourceObservationId).slice(0, limit);
  }
  const effectiveStances = new Set(belief.hypotheses.filter((hypothesis) => isCurrentlyEffectiveHypothesis(hypothesis)).map((hypothesis) => hypothesis.stance));

  function addTemplateRecommendation(template: (typeof templates)[number]) {
    const proposition = template.proposition(title).trim();
    const key = normalizedTextKey(proposition);
    if (!proposition || seen.has(key)) return false;
    seen.add(key);
    recommendations.push({
      proposition,
      stance: template.stance,
      priorProbability: template.priorProbability,
      notes: template.notes,
      evidenceSearchQuery: `${context} ${proposition}`.trim(),
      rationale: template.rationale
    });
    return true;
  }

  for (const missingStance of [
    effectiveStances.has("SUPPORTS") ? undefined : "SUPPORTS",
    effectiveStances.has("OPPOSES") ? undefined : "OPPOSES"
  ] as Array<HypothesisRecord["stance"] | undefined>) {
    if (!missingStance || recommendations.some((recommendation) => recommendation.stance === missingStance)) continue;
    const template = templates.find((candidate) => candidate.stance === missingStance);
    if (!template) continue;
    if (recommendations.length >= limit) {
      const replaceIndex = recommendations.findLastIndex((recommendation) => recommendation.sourceObservationId && recommendation.stance !== missingStance);
      if (replaceIndex < 0) continue;
      recommendations.splice(replaceIndex, 1);
    }
    addTemplateRecommendation(template);
  }

  for (const template of templates) {
    if (recommendations.length >= limit) break;
    addTemplateRecommendation(template);
  }

  return recommendations;
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

function estimatorDirection(output: EstimatorOutput): "SUPPORTS" | "OPPOSES" | "MIXED" | "NEUTRAL" {
  if (output.direction === "SUPPORTS" || output.direction === "OPPOSES" || output.direction === "MIXED" || output.direction === "NEUTRAL") {
    return output.direction;
  }
  const likelihoodRatio = output.likelihoodRatio ?? 1;
  if (likelihoodRatio > 1.05) return "SUPPORTS";
  if (likelihoodRatio < 0.95) return "OPPOSES";
  return "NEUTRAL";
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
  return new Map(queries.map((query) => [query.query, query]));
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
    ...(query.priority !== undefined ? { queryPriority: query.priority } : {}),
    ...(query.priorityReason ? { queryPriorityReason: query.priorityReason } : {}),
    ...(query.uncertainty !== undefined ? { queryUncertainty: query.uncertainty } : {}),
    ...(query.evidenceCount !== undefined ? { queryEvidenceCount: query.evidenceCount } : {}),
    ...(query.settlementDue ? { querySettlementDue: true } : {}),
    ...(query.expiresAt ? { queryExpiresAt: query.expiresAt } : {}),
    ...(query.expiryCondition ? { queryExpiryCondition: query.expiryCondition } : {})
  };
}

export function createWorldModelServices(
  store: WorldModelStore,
  options: WorldModelServiceOptions = {}
): WorldModelServices {
  async function applyAutoApplyPolicy(input: AutoApplyPolicyInput) {
    return options.autoApplyPolicy ? await options.autoApplyPolicy(input) : input;
  }

  async function createObservation(input: CreateObservationInput) {
    const parsed = createObservationSchema.parse(input);
    const existing = await store.listObservations();
    const decision = deduplicateObservation(
      {
        ...toDedupeObservation(parsed),
        normalizedHash: parsed.normalizedHash,
        semanticKey: parsed.semanticKey
      },
      existing
    );
    const observedAt = now();
    return store.createObservation({
      id: createRecordId("observation"),
      sourceId: parsed.sourceId,
      title: parsed.title.trim(),
      content: parsed.content.trim(),
      url: parsed.url,
      author: parsed.author,
      publishedAt: parsed.publishedAt,
      observedAt,
      normalizedHash: parsed.normalizedHash,
      semanticKey: parsed.semanticKey,
      status: decision.duplicate ? "DUPLICATE" : "PENDING",
      duplicateOfId: decision.duplicateOfId,
      credibility: parsed.credibility ?? 0.5,
      metadata: parsed.metadata ?? {}
    });
  }

  async function updateObservation(observationId: string, input: UpdateObservationInput) {
    const observation = await store.getObservation(observationId);
    if (!observation) throw new Error(`Observation not found: ${observationId}`);
    const parsed = updateObservationSchema.parse(input);
    const isSourceOnlyPatch = Object.keys(parsed).every((key) => key === "sourceId");
    if (observation.status === "CONFIRMED" && !isSourceOnlyPatch) {
      throw new Error("Confirmed observations must be edited from the evidence record.");
    }
    if (parsed.sourceId) {
      const source = await store.getSource(parsed.sourceId);
      if (!source) throw new Error(`Source not found: ${parsed.sourceId}`);
    }
    const patch: Partial<ObservationRecord> = {
      ...(parsed.sourceId !== undefined ? { sourceId: parsed.sourceId ?? undefined } : {}),
      ...(parsed.title !== undefined ? { title: parsed.title.trim() } : {}),
      ...(parsed.content !== undefined ? { content: parsed.content.trim() } : {}),
      ...(parsed.url !== undefined ? { url: parsed.url } : {}),
      ...(parsed.author !== undefined ? { author: parsed.author } : {}),
      ...(parsed.credibility !== undefined ? { credibility: parsed.credibility } : {}),
      ...(parsed.normalizedHash !== undefined ? { normalizedHash: parsed.normalizedHash } : {}),
      ...(parsed.semanticKey !== undefined ? { semanticKey: parsed.semanticKey } : {}),
      ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {})
    };
    const shouldRefreshRecommendations =
      observation.status !== "DUPLICATE" &&
      observation.status !== "REJECTED" &&
      (parsed.title !== undefined || parsed.content !== undefined || parsed.credibility !== undefined);

    if (shouldRefreshRecommendations) {
      const updatedObservation = { ...observation, ...patch, metadata: patch.metadata ?? observation.metadata };
      const recommendation = await recommendedEvidenceLinks(updatedObservation, DEFAULT_CANDIDATE_THRESHOLD);
      const links = recommendation.links;
      const metadata = { ...(patch.metadata ?? observation.metadata) };
      const wasCandidateLifecycle =
        observation.status === "UNKNOWN" ||
        Array.isArray(metadata.recommendedLinks) ||
        typeof metadata.reviewReason === "string";
      delete metadata.recommendedLinks;
      delete metadata.reviewReason;
      delete metadata.candidateEvaluation;

      if (links.length > 0) {
        delete metadata.ignoredReason;
        metadata.recommendedLinks = links;
        metadata.reviewReason = "OBSERVATION_EDIT";
        if (observation.status === "UNKNOWN") patch.status = "PENDING";
      } else if (wasCandidateLifecycle) {
        metadata.ignoredReason = "UNMATCHED";
        if (recommendation.candidateEvaluation) {
          metadata.candidateEvaluation = recommendation.candidateEvaluation;
        }
        patch.status = "UNKNOWN";
      }

      patch.metadata = metadata;
    }

    return store.updateObservation(observation.id, patch);
  }

  async function rejectObservation(observationId: string) {
    const observation = await store.getObservation(observationId);
    if (!observation) throw new Error(`Observation not found: ${observationId}`);
    if (observation.status === "CONFIRMED") {
      throw new Error("Confirmed observations must be rejected from the evidence record.");
    }
    return store.updateObservation(observation.id, { status: "REJECTED" });
  }

  async function settleObservation(input: SettleObservationInput) {
    const observation = await store.getObservation(input.observationId);
    if (!observation) throw new Error(`Observation not found: ${input.observationId}`);
    if (observation.metadata.reviewReason !== "SETTLEMENT_REVIEW") {
      throw new Error("Only settlement review observations can settle hypotheses.");
    }
    const metadataHypothesisId =
      metadataText(observation.metadata.settlementHypothesisId) || metadataText(observation.metadata.queryHypothesisId);
    if (metadataHypothesisId && metadataHypothesisId !== input.hypothesisId) {
      throw new Error("Settlement observation target does not match the submitted hypothesis.");
    }
    const resolvedOutcome = input.resolvedOutcome?.trim() || observation.content || observation.title;
    const hypothesis = await updateHypothesisRecord(input.hypothesisId, {
      status: input.outcome,
      currentProbability: input.outcome === "RESOLVED_TRUE" ? 1 : 0,
      resolvedOutcome
    });
    const settledObservation = await store.updateObservation(observation.id, {
      status: "SETTLED",
      metadata: {
        ...observation.metadata,
        settlementResolved: true,
        settlementOutcome: input.outcome,
        settlementResolvedHypothesisId: input.hypothesisId,
        settlementResolvedOutcome: resolvedOutcome,
        settlementResolvedAt: now().toISOString()
      }
    });

    return { observation: settledObservation, hypothesis };
  }

  async function confirmObservation(input: ConfirmEvidenceInput) {
    const parsed = confirmEvidenceSchema.parse(input);
    const observation = await store.getObservation(parsed.observationId);
    if (!observation) throw new Error(`Observation not found: ${parsed.observationId}`);
    if (observation.status === "REJECTED") {
      throw new Error("Rejected observations cannot be confirmed as evidence.");
    }
    const existingEvidence = (await store.listEvidence()).find((item) => item.observationId === observation.id);
    if (existingEvidence) throw new Error(`Observation is already confirmed as evidence: ${observation.title}`);

    await resolveHypothesesForLinks(store, parsed.links);

    const confirmedAt = now();
    const evidenceId = createRecordId("evidence");
    const links: EvidenceHypothesisLinkRecord[] = parsed.links.map((link) => ({
      id: createRecordId("evidence_link"),
      evidenceId,
      hypothesisId: link.hypothesisId,
      direction: link.direction,
      relevance: link.relevance,
      likelihoodRatio: link.likelihoodRatio,
      confidence: link.confidence,
      rationale: link.rationale,
      createdAt: confirmedAt
    }));
    const evidence = await store.createEvidence({
      id: evidenceId,
      observationId: observation.id,
      title: observation.title,
      content: observation.content,
      url: observation.url,
      confirmedAt,
      confirmationMode: parsed.confirmationMode,
      credibility: observation.credibility,
      status: "ACTIVE",
      metadata: observation.metadata,
      links
    });
    await store.updateObservation(observation.id, { status: "CONFIRMED" });
    return evidence;
  }

  async function createPreview(evidenceId: string) {
    const previews = await createPreviews(evidenceId);
    if (previews.length !== 1) {
      throw new Error("Evidence spans multiple beliefs and must be applied as grouped updates.");
    }
    return previews[0];
  }

  async function createPreviews(evidenceId: string) {
    const evidence = await store.getEvidence(evidenceId);
    if (!evidence) throw new Error(`Evidence not found: ${evidenceId}`);
    return createEvidencePreviews(store, evidence);
  }

  async function createCandidatePreview(links: ConfirmEvidenceInput["links"], credibility: number) {
    const hypotheses = await Promise.all(links.map((link) => store.getHypothesis(link.hypothesisId)));
    const presentHypotheses = hypotheses.filter((hypothesis): hypothesis is HypothesisRecord => Boolean(hypothesis));
    if (presentHypotheses.length !== links.length) {
      throw new Error("Evidence links reference missing hypotheses.");
    }
    const beliefIds = new Set(presentHypotheses.map((hypothesis) => hypothesis.beliefId));
    if (beliefIds.size !== 1) {
      throw new Error("A single update preview must target one belief.");
    }
    const belief = await store.getBelief(presentHypotheses[0].beliefId);
    if (!belief) throw new Error(`Belief not found: ${presentHypotheses[0].beliefId}`);

    return createUpdatePreview(
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
      links.map((link) => ({
        hypothesisId: link.hypothesisId,
        likelihoodRatio: link.likelihoodRatio,
        credibility,
        confidence: link.confidence,
        rationale: link.rationale
      }))
    );
  }

  async function assertEvidenceHasNoActiveUpdate(evidenceId: string | undefined, beliefId?: string) {
    if (!evidenceId) return;
    const activeUpdate = (await store.listUpdateEvents()).find(
      (event) =>
        event.evidenceId === evidenceId &&
        event.status === "APPLIED" &&
        (beliefId === undefined || event.beliefId === beliefId)
    );
    if (activeUpdate) {
      throw new Error(`Evidence already has an active update: ${evidenceId}`);
    }
  }

  async function applyPreview(
    preview: UpdatePreview,
    likelihoodRunId?: string,
    likelihoodRunIds: string[] = likelihoodRunId ? [likelihoodRunId] : []
  ): Promise<BayesianUpdateEventRecord> {
    await assertEvidenceHasNoActiveUpdate(preview.evidenceId, preview.beliefId);
    const event = applyUpdate(preview, { id: createRecordId("update"), createdAt: now() });
    await store.updateHypothesisProbabilities(event.posteriorSnapshot);
    return store.createUpdateEvent({
      id: event.id,
      beliefId: event.beliefId,
      evidenceId: preview.evidenceId ?? "unknown",
      likelihoodRunId,
      likelihoodRunIds,
      priorSnapshot: event.priorSnapshot,
      posteriorSnapshot: event.posteriorSnapshot,
      mode: "APPLIED",
      status: "APPLIED",
      confidence: event.confidence,
      explanations: event.explanations,
      createdAt: event.createdAt
    });
  }

  async function applyEvidenceUpdates(
    evidenceId: string,
    likelihoodRunId?: string,
    likelihoodRunIdsByBeliefId: Map<string, string[]> = new Map()
  ): Promise<BayesianUpdateEventRecord[]> {
    const evidence = await store.getEvidence(evidenceId);
    if (!evidence) throw new Error(`Evidence not found: ${evidenceId}`);
    const previews = await createEvidencePreviews(store, evidence);
    const events: BayesianUpdateEventRecord[] = [];
    for (const preview of previews) {
      const beliefLikelihoodRunIds = likelihoodRunIdsByBeliefId.get(preview.beliefId) ?? (likelihoodRunId ? [likelihoodRunId] : []);
      events.push(await applyPreview(preview, beliefLikelihoodRunIds[0], beliefLikelihoodRunIds));
    }
    return events;
  }

  async function createLikelihoodRunsForConfirmedLinks(evidence: EvidenceRecord, links: ConfirmEvidenceInput["links"]) {
    const runIdsByBeliefId = new Map<string, string[]>();
    for (const link of links) {
      if (!link.estimatorOutputs || link.estimatorOutputs.length === 0) continue;
      const hypothesis = await store.getHypothesis(link.hypothesisId);
      if (!hypothesis) throw new Error(`Hypothesis not found: ${link.hypothesisId}`);
      const ensemble = combineEstimatorOutputs(link.estimatorOutputs);
      const likelihoodRun = await store.createLikelihoodRun({
        id: createRecordId("likelihood"),
        evidenceId: evidence.id,
        hypothesisId: link.hypothesisId,
        ensembleLikelihoodRatio: ensemble.likelihoodRatio,
        ensembleConfidence: ensemble.confidence,
        estimatorOutputs: link.estimatorOutputs,
        modelVersion: ensemble.modelVersion,
        createdAt: now()
      });
      runIdsByBeliefId.set(hypothesis.beliefId, [...(runIdsByBeliefId.get(hypothesis.beliefId) ?? []), likelihoodRun.id]);
    }
    return runIdsByBeliefId;
  }

  async function rebaseActiveUpdatesForBelief(beliefId: string) {
    const belief = await store.getBelief(beliefId);
    if (!belief) throw new Error(`Belief not found: ${beliefId}`);
    let probabilities = baseProbabilitySnapshot(belief);
    const activeEvents = (await store.listUpdateEvents())
      .filter((event) => event.beliefId === beliefId && event.status === "APPLIED")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    for (const event of activeEvents) {
      const evidence = await store.getEvidence(event.evidenceId);
      if (!evidence || evidence.status !== "ACTIVE") continue;
      const links = await evidenceLinksForBelief(store, evidence, beliefId);
      if (links.length === 0) {
        await store.updateUpdateEvent(event.id, {
          status: "ROLLED_BACK",
          rolledBackAt: now()
        });
        continue;
      }
      const preview = createUpdatePreview(
        createBeliefForSnapshotPreview(belief, probabilities),
        links.map((link) => evidenceLinkToPreviewLink(link, evidence.credibility))
      );
      probabilities = preview.posteriorSnapshot;
      await store.updateUpdateEvent(event.id, {
        priorSnapshot: preview.priorSnapshot,
        posteriorSnapshot: preview.posteriorSnapshot
      });
    }

    await store.updateHypothesisProbabilities(probabilities);
    return probabilities;
  }

  async function confirmAndApplyObservation(input: ConfirmEvidenceInput): Promise<ConfirmAndApplyEvidenceResult> {
    const evidence = await confirmObservation(input);
    const likelihoodRunIdsByBeliefId = await createLikelihoodRunsForConfirmedLinks(evidence, input.links);
    const events = await applyEvidenceUpdates(evidence.id, undefined, likelihoodRunIdsByBeliefId);
    return { evidence, event: events[0] ?? null, events };
  }

  async function rollbackEvent(eventId: string) {
    const event = await store.getUpdateEvent(eventId);
    if (!event) throw new Error(`Update event not found: ${eventId}`);
    if (event.status === "ROLLED_BACK") throw new Error(`Update event is already rolled back: ${eventId}`);
    const rolledBack = rollbackUpdate(
      {
        id: event.id,
        beliefId: event.beliefId,
        priorSnapshot: event.priorSnapshot,
        posteriorSnapshot: event.posteriorSnapshot,
        mode: "APPLIED",
        status: "APPLIED",
        confidence: event.confidence,
        explanations: event.explanations,
        createdAt: event.createdAt
      },
      now()
    );
    const saved = await store.updateUpdateEvent(eventId, {
      status: "ROLLED_BACK",
      rolledBackAt: rolledBack.rolledBackAt
    });
    const restoredProbabilities = await rebaseActiveUpdatesForBelief(event.beliefId);
    return { ...saved, restoredProbabilities };
  }

  async function rollbackAppliedEvidenceEvents(evidenceId: string) {
    const events = (await store.listUpdateEvents())
      .filter((event) => event.evidenceId === evidenceId && event.status === "APPLIED")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    for (const event of events) {
      await rollbackEvent(event.id);
    }
  }

  async function activeEvidenceLinkedToHypothesis(hypothesisId: string) {
    return (await store.listEvidence())
      .filter(
        (evidence) =>
          evidence.status === "ACTIVE" &&
          evidence.links.some((link) => link.hypothesisId === hypothesisId)
      )
      .sort((left, right) => left.confirmedAt.getTime() - right.confirmedAt.getTime());
  }

  async function assertLinksReferenceExistingHypotheses(links: Array<{ hypothesisId: string }>) {
    await resolveHypothesesForLinks(store, links);
  }

  async function renormalizeMutuallyExclusiveBelief(beliefId: string) {
    const belief = await store.getBelief(beliefId);
    if (!belief || belief.probabilityMode !== "MUTUALLY_EXCLUSIVE" || belief.hypotheses.length === 0) return;
    const probabilities = normalizeMutuallyExclusive(belief.hypotheses.map((hypothesis) => hypothesis.currentProbability));
    await store.updateHypothesisProbabilities(
      Object.fromEntries(belief.hypotheses.map((hypothesis, index) => [hypothesis.id, probabilities[index]]))
    );
  }

  async function updateBeliefRecord(beliefId: string, input: UpdateBeliefInput) {
    const existing = await store.getBelief(beliefId);
    if (!existing) throw new Error(`Belief not found: ${beliefId}`);
    const parsed = updateBeliefSchema.parse(input);
    const probabilityModeChanged = parsed.probabilityMode !== undefined && parsed.probabilityMode !== existing.probabilityMode;
    const updated = await store.updateBelief(beliefId, { ...parsed, updatedAt: now() });
    const hasActiveUpdates = (await store.listUpdateEvents()).some((event) => event.beliefId === beliefId && event.status === "APPLIED");
    if (probabilityModeChanged && hasActiveUpdates) {
      await rebaseActiveUpdatesForBelief(beliefId);
      return (await store.getBelief(beliefId)) ?? updated;
    }
    if (parsed.probabilityMode === "MUTUALLY_EXCLUSIVE") {
      await renormalizeMutuallyExclusiveBelief(beliefId);
      return (await store.getBelief(beliefId)) ?? updated;
    }
    return updated;
  }

  async function updateHypothesisRecord(hypothesisId: string, input: UpdateHypothesisInput) {
    const existing = await store.getHypothesis(hypothesisId);
    if (!existing) throw new Error(`Hypothesis not found: ${hypothesisId}`);
    const parsed = updateHypothesisSchema.parse(input);
    if (parsed.beliefId) {
      const targetBelief = await store.getBelief(parsed.beliefId);
      if (!targetBelief) throw new Error(`Belief not found: ${parsed.beliefId}`);
    }
    const activeUpdatesBeforeEdit = await store.listUpdateEvents();

    const beliefMoved = parsed.beliefId !== undefined && parsed.beliefId !== existing.beliefId;
    const effectivenessMayChange =
      parsed.status !== undefined || parsed.startsAt !== undefined || parsed.expiresAt !== undefined;
    const settlingHypothesis = parsed.status === "RESOLVED_TRUE" || parsed.status === "RESOLVED_FALSE";
    const currentProbabilityIsDerived =
      parsed.currentProbability !== undefined &&
      parsed.priorProbability === undefined &&
      !settlingHypothesis &&
      activeUpdatesBeforeEdit.some((event) => event.status === "APPLIED" && event.beliefId === existing.beliefId);
    const affectedEvidence = beliefMoved || effectivenessMayChange ? await activeEvidenceLinkedToHypothesis(hypothesisId) : [];
    for (const evidence of affectedEvidence) {
      await rollbackAppliedEvidenceEvents(evidence.id);
    }

    const updated = await store.updateHypothesis(hypothesisId, {
      ...parsed,
      currentProbability: currentProbabilityIsDerived
        ? undefined
        : parsed.currentProbability ?? (parsed.priorProbability !== undefined ? parsed.priorProbability : undefined),
      updatedAt: now()
    });
    await renormalizeMutuallyExclusiveBelief(existing.beliefId);
    if (updated.beliefId !== existing.beliefId) {
      await renormalizeMutuallyExclusiveBelief(updated.beliefId);
    }
    if (parsed.priorProbability !== undefined && updated.beliefId === existing.beliefId) {
      await rebaseActiveUpdatesForBelief(updated.beliefId);
    }
    if (currentProbabilityIsDerived && updated.beliefId === existing.beliefId) {
      await rebaseActiveUpdatesForBelief(updated.beliefId);
    }
    for (const evidence of affectedEvidence) {
      const latest = await store.getEvidence(evidence.id);
      if (latest?.status === "ACTIVE") {
        await applyEvidenceUpdates(latest.id);
      }
    }
    return (await store.getHypothesis(hypothesisId)) ?? updated;
  }

  async function updateAndReapplyEvidence(evidenceId: string, input: UpdateEvidenceInput): Promise<ConfirmAndApplyEvidenceResult> {
    const existing = await store.getEvidence(evidenceId);
    if (!existing) throw new Error(`Evidence not found: ${evidenceId}`);
    if (existing.status === "DELETED") throw new Error(`Evidence is deleted and cannot be edited: ${existing.title}`);

    const parsed = updateEvidenceSchema.parse(input);
    if (parsed.links) {
      await assertLinksReferenceExistingHypotheses(parsed.links);
    }
    await rollbackAppliedEvidenceEvents(evidenceId);
    const updatedAt = now();
    const links = parsed.links?.map((link) => ({
      id: createRecordId("evidence_link"),
      evidenceId,
      hypothesisId: link.hypothesisId,
      direction: link.direction,
      relevance: link.relevance,
      likelihoodRatio: link.likelihoodRatio,
      confidence: link.confidence,
      rationale: link.rationale,
      createdAt: updatedAt
    }));
    const evidence = await store.updateEvidence(evidenceId, {
      ...(parsed.title !== undefined ? { title: parsed.title.trim() } : {}),
      ...(parsed.content !== undefined ? { content: parsed.content.trim() } : {}),
      ...(parsed.url !== undefined ? { url: parsed.url } : {}),
      ...(parsed.credibility !== undefined ? { credibility: parsed.credibility } : {}),
      ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
      status: "ACTIVE",
      ...(links ? { links } : {})
    });
    await store.updateObservation(existing.observationId, {
      ...(parsed.title !== undefined ? { title: parsed.title.trim() } : {}),
      ...(parsed.content !== undefined ? { content: parsed.content.trim() } : {}),
      ...(parsed.url !== undefined ? { url: parsed.url } : {}),
      ...(parsed.credibility !== undefined ? { credibility: parsed.credibility } : {}),
      ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
      status: "CONFIRMED"
    });
    const likelihoodRunIdsByBeliefId = parsed.links
      ? await createLikelihoodRunsForConfirmedLinks(evidence, parsed.links)
      : new Map<string, string[]>();
    const events = await applyEvidenceUpdates(evidence.id, undefined, likelihoodRunIdsByBeliefId);
    return { evidence, event: events[0] ?? null, events };
  }

  async function connectEvidenceHypothesis(
    evidenceId: string,
    input: ConnectEvidenceHypothesisInput
  ): Promise<ConfirmAndApplyEvidenceResult> {
    const evidence = await store.getEvidence(evidenceId);
    if (!evidence) throw new Error(`Evidence not found: ${evidenceId}`);
    const hypothesis = await store.getHypothesis(input.hypothesisId);
    if (!hypothesis) throw new Error(`Hypothesis not found: ${input.hypothesisId}`);
    const parsed = connectEvidenceHypothesisSchema.parse(input);
    const links = new Map(evidence.links.map((link) => [link.hypothesisId, link]));
    links.set(parsed.hypothesisId, {
      id: createRecordId("evidence_link"),
      evidenceId,
      hypothesisId: parsed.hypothesisId,
      direction: parsed.direction,
      relevance: parsed.relevance,
      likelihoodRatio: parsed.likelihoodRatio,
      confidence: parsed.confidence,
      rationale: parsed.rationale,
      createdAt: now()
    });

    return updateAndReapplyEvidence(evidenceId, {
      title: evidence.title,
      content: evidence.content,
      url: evidence.url,
      credibility: evidence.credibility,
      metadata: evidence.metadata,
      links: [...links.values()].map((link) => ({
        hypothesisId: link.hypothesisId,
        direction: link.direction,
        relevance: link.relevance,
        likelihoodRatio: link.likelihoodRatio,
        confidence: link.confidence,
        rationale: link.rationale
      }))
    });
  }

  async function disconnectEvidenceHypothesis(
    evidenceId: string,
    input: DisconnectEvidenceHypothesisInput
  ): Promise<ConfirmAndApplyEvidenceResult> {
    const evidence = await store.getEvidence(evidenceId);
    if (!evidence) throw new Error(`Evidence not found: ${evidenceId}`);
    const parsed = disconnectEvidenceHypothesisSchema.parse(input);
    const remainingLinks = evidence.links.filter((link) => link.hypothesisId !== parsed.hypothesisId);
    if (remainingLinks.length === evidence.links.length) {
      throw new Error(`Evidence is not linked to hypothesis: ${parsed.hypothesisId}`);
    }

    return updateAndReapplyEvidence(evidenceId, {
      title: evidence.title,
      content: evidence.content,
      url: evidence.url,
      credibility: evidence.credibility,
      metadata: evidence.metadata,
      links: remainingLinks.map((link) => ({
        hypothesisId: link.hypothesisId,
        direction: link.direction,
        relevance: link.relevance,
        likelihoodRatio: link.likelihoodRatio,
        confidence: link.confidence,
        rationale: link.rationale
      }))
    });
  }

  async function rejectEvidence(evidenceId: string) {
    const existing = await store.getEvidence(evidenceId);
    if (!existing) throw new Error(`Evidence not found: ${evidenceId}`);
    await rollbackAppliedEvidenceEvents(evidenceId);
    await store.updateObservation(existing.observationId, { status: "REJECTED" });
    return store.updateEvidence(evidenceId, { status: "REJECTED" });
  }

  async function deleteEvidence(evidenceId: string) {
    const existing = await store.getEvidence(evidenceId);
    if (!existing) throw new Error(`Evidence not found: ${evidenceId}`);
    if (existing.status === "DELETED") return existing;
    await rollbackAppliedEvidenceEvents(evidenceId);
    await store.updateObservation(existing.observationId, { status: "REJECTED" });
    return store.updateEvidence(evidenceId, { status: "DELETED" });
  }

  async function listVisibleEvidence() {
    return (await store.listEvidence()).filter((evidence) => evidence.status !== "DELETED");
  }

  async function recommendedEvidenceLinks(
    observation: Awaited<ReturnType<typeof createObservation>>,
    threshold: number,
    recommendationOptions: EvidenceLinkRecommendationOptions = {}
  ): Promise<EvidenceLinkRecommendationResult> {
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
        const output = await options.likelihoodEstimator.estimate({
          evidenceText: `${observation.title}\n${observation.content}`,
          hypothesis: candidate.hypothesis.proposition,
          category: candidate.belief.category,
          sourceCredibility: observation.credibility,
          evidencePublishedAt: observation.publishedAt,
          evidenceObservedAt: observation.observedAt,
          context: `${candidate.belief.title}\n${candidate.belief.description}\n${candidate.hypothesis.notes}\n${candidate.hypothesis.evidenceSearchQuery ?? ""}`
        });

        candidateEvaluation.attemptedCount += 1;
        if (output.rationale?.trim()) {
          candidateEvaluation.latestRationale = output.rationale.trim();
        }

        if (!isUsableEstimatorOutput(output)) {
          if (output.abstain) {
            candidateEvaluation.abstainedCount += 1;
          } else {
            candidateEvaluation.rejectedCount += 1;
          }
          continue;
        }
        sawUsableOutput = true;
        candidateEvaluation.usableCount += 1;
        const relevance = output.relevance ?? Math.max(candidate.score, candidate.queryHintScore);
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
            likelihoodRatio: output.likelihoodRatio ?? 1,
            confidence: output.confidence ?? 0.1,
            rationale:
              output.rationale ??
              `LLM 自动关联到「${candidate.belief.title}」下的假设：${candidate.hypothesis.proposition}`,
            ...(output.reviewRequired ? { reviewRequired: true } : {}),
            estimatorOutputs: [output]
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
      await store.updateObservation(observation.id, {
        status: "UNKNOWN",
        metadata: {
          ...cleanCandidateLifecycleMetadata(observation.metadata),
          ignoredReason: "UNMATCHED",
          ...(recommendation.candidateEvaluation ? { candidateEvaluation: recommendation.candidateEvaluation } : {})
        }
      });
      result.unmatchedCount = 1;
      return result;
    }

    const cleanMetadata = cleanCandidateLifecycleMetadata(observation.metadata);
    const preview = await createCandidatePreview(links, observation.credibility);
    if (largestProbabilityDelta(preview) < DEFAULT_MIN_CANDIDATE_PROBABILITY_DELTA) {
      await store.updateObservation(observation.id, {
        status: "UNKNOWN",
        metadata: {
          ...cleanMetadata,
          ignoredReason: "LOW_IMPACT",
          recommendedLinks: links,
          ...(recommendation.candidateEvaluation ? { candidateEvaluation: recommendation.candidateEvaluation } : {})
        }
      });
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
    await confirmAndApplyObservation({
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
    await confirmAndApplyObservation({
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

  function normalizeQueryPart(value: string) {
    return value.toLowerCase().replace(/\s+/g, " ").trim();
  }

  function queryTokens(value: string) {
    return normalizeQueryPart(value).split(" ").filter(Boolean);
  }

  function sharedPrefixLength(left: string[], right: string[]) {
    let index = 0;
    while (index < left.length && index < right.length && left[index] === right[index]) {
      index += 1;
    }
    return index;
  }

  function compactSearchQuery(parts: string[]) {
    const selected: Array<{ value: string; normalized: string; tokens: string[] }> = [];
    for (const part of parts.map((value) => value.trim()).filter(Boolean)) {
      const normalized = normalizeQueryPart(part);
      const tokens = queryTokens(part);
      if (!normalized) continue;
      if (selected.some((item) => item.normalized === normalized || item.normalized.includes(normalized))) {
        continue;
      }
      for (let index = selected.length - 1; index >= 0; index -= 1) {
        if (normalized.includes(selected[index].normalized)) {
          selected.splice(index, 1);
        }
      }
      const prefixMatch = selected.find((item) => {
        const prefixLength = sharedPrefixLength(item.tokens, tokens);
        return prefixLength >= 3 && prefixLength < tokens.length && prefixLength < item.tokens.length;
      });
      if (prefixMatch) {
        const suffix = part.split(/\s+/).slice(sharedPrefixLength(prefixMatch.tokens, tokens)).join(" ");
        if (suffix) {
          prefixMatch.value = `${prefixMatch.value} ${suffix}`;
          prefixMatch.normalized = normalizeQueryPart(prefixMatch.value);
          prefixMatch.tokens = queryTokens(prefixMatch.value);
        }
        continue;
      }
      selected.push({ value: part, normalized, tokens });
    }
    return selected.map((item) => item.value).join(" ");
  }

  function evidenceSearchQueryFromNotes(notes: string) {
    for (const line of notes.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:证据检索|evidenceSearchQuery|evidence search)\s*[:：]\s*(.+?)\s*$/i);
      const query = match?.[1]?.trim();
      if (query) return query;
    }
    return "";
  }

  function hypothesisEvidenceSearchQuery(belief: BeliefRecord, hypothesis: HypothesisRecord) {
    const structuredQuery = hypothesis.evidenceSearchQuery?.trim() ?? "";
    if (structuredQuery) return compactSearchQuery([structuredQuery]);
    const explicitQuery = evidenceSearchQueryFromNotes(hypothesis.notes);
    return explicitQuery ? compactSearchQuery([explicitQuery]) : compactSearchQuery([belief.title, hypothesis.proposition, hypothesis.notes]);
  }

  function hypothesisSettlementSearchQuery(belief: BeliefRecord, hypothesis: HypothesisRecord) {
    return compactSearchQuery([
      hypothesis.evidenceSearchQuery ?? "",
      belief.title,
      hypothesis.proposition,
      hypothesis.expiryCondition ?? "",
      "final outcome result settlement"
    ]);
  }

  function queryHintScore(queryHint: string, belief: BeliefRecord, hypothesis: HypothesisRecord) {
    if (!queryHint) return 0;
    const candidateQuery = hypothesisEvidenceSearchQuery(belief, hypothesis);
    return normalizeQueryPart(queryHint) === normalizeQueryPart(candidateQuery) ? 1 : 0;
  }

  function hypothesisUncertainty(hypothesis: HypothesisRecord) {
    return Math.max(0, Math.min(1, 1 - Math.abs(hypothesis.currentProbability - 0.5) * 2));
  }

  function staleEvidenceDays(latestEvidenceAt: string | undefined, referenceTime: Date) {
    if (!latestEvidenceAt) return undefined;
    const latest = new Date(latestEvidenceAt);
    if (Number.isNaN(latest.getTime())) return undefined;
    const days = Math.max(0, Math.floor((referenceTime.getTime() - latest.getTime()) / DAY_MS));
    return days >= STALE_EVIDENCE_QUERY_DAYS ? days : undefined;
  }

  function calibrationPressureByBelief(beliefs: BeliefRecord[]) {
    const pressure = new Map<string, { error: number; hypothesisId: string }>();

    for (const belief of beliefs) {
      for (const hypothesis of belief.hypotheses) {
        const outcome = resolvedOutcomeValue(hypothesis.status);
        if (outcome === null) continue;

        const predictedProbability = Math.min(1, Math.max(0, hypothesis.currentProbability));
        const error = Math.abs(predictedProbability - outcome);
        if (error < CALIBRATION_QUERY_ERROR_THRESHOLD) continue;

        const existing = pressure.get(belief.id);
        if (!existing || error > existing.error || (error === existing.error && hypothesis.id < existing.hypothesisId)) {
          pressure.set(belief.id, { error, hypothesisId: hypothesis.id });
        }
      }
    }

    return pressure;
  }

  function activeEvidenceCoverageByHypothesis(evidenceItems: EvidenceRecord[]) {
    const coverage = new Map<
      string,
      {
        evidenceCount: number;
        supportEvidenceCount: number;
        opposingEvidenceCount: number;
        relevanceSum: number;
        confidenceSum: number;
        linkCount: number;
        latestEvidenceAt?: string;
      }
    >();
    for (const evidence of evidenceItems) {
      if (evidence.status !== "ACTIVE") continue;
      for (const link of evidence.links) {
        const existing = coverage.get(link.hypothesisId) ?? {
          evidenceCount: 0,
          supportEvidenceCount: 0,
          opposingEvidenceCount: 0,
          relevanceSum: 0,
          confidenceSum: 0,
          linkCount: 0
        };
        const confirmedAt = evidence.confirmedAt.toISOString();
        coverage.set(link.hypothesisId, {
          evidenceCount: existing.evidenceCount + 1,
          supportEvidenceCount: existing.supportEvidenceCount + (link.direction === "SUPPORTS" ? 1 : 0),
          opposingEvidenceCount: existing.opposingEvidenceCount + (link.direction === "OPPOSES" ? 1 : 0),
          relevanceSum: existing.relevanceSum + link.relevance,
          confidenceSum: existing.confidenceSum + link.confidence,
          linkCount: existing.linkCount + 1,
          latestEvidenceAt:
            !existing.latestEvidenceAt || confirmedAt > existing.latestEvidenceAt ? confirmedAt : existing.latestEvidenceAt
        });
      }
    }
    return coverage;
  }

  function evidenceLoopQueryPriority(
    hypothesis: HypothesisRecord,
    coverage: {
      evidenceCount: number;
      supportEvidenceCount?: number;
      opposingEvidenceCount?: number;
      relevanceSum?: number;
      confidenceSum?: number;
      linkCount?: number;
      latestEvidenceAt?: string;
    },
    calibrationPressure?: { error: number; hypothesisId: string; hypothesisCode?: string },
    referenceTime = now()
  ) {
    const uncertainty = hypothesisUncertainty(hypothesis);
    const evidenceGap = coverage.evidenceCount === 0 ? 1 : Math.max(0, 1 - Math.min(coverage.evidenceCount, 3) / 3);
    const basePriority = uncertainty * 0.7 + evidenceGap * 0.3;
    const calibrationBoost = calibrationPressure ? calibrationPressure.error * CALIBRATION_QUERY_PRIORITY_WEIGHT : 0;
    const supportEvidenceCount = coverage.supportEvidenceCount ?? 0;
    const opposingEvidenceCount = coverage.opposingEvidenceCount ?? 0;
    const counterEvidenceGap =
      hypothesis.currentProbability >= COUNTER_EVIDENCE_QUERY_PROBABILITY_THRESHOLD &&
      supportEvidenceCount > 0 &&
      opposingEvidenceCount === 0;
    const counterEvidenceBoost = counterEvidenceGap ? COUNTER_EVIDENCE_QUERY_PRIORITY_BOOST : 0;
    const staleDays = staleEvidenceDays(coverage.latestEvidenceAt, referenceTime);
    const staleEvidenceBoost = staleDays === undefined ? 0 : STALE_EVIDENCE_QUERY_PRIORITY_BOOST;
    const linkCount = coverage.linkCount ?? 0;
    const averageEvidenceRelevance = linkCount > 0 && coverage.relevanceSum !== undefined ? coverage.relevanceSum / linkCount : undefined;
    const averageEvidenceConfidence = linkCount > 0 && coverage.confidenceSum !== undefined ? coverage.confidenceSum / linkCount : undefined;
    const fragileCertainty =
      coverage.evidenceCount > 0 &&
      (hypothesis.currentProbability >= FRAGILE_CERTAINTY_QUERY_PROBABILITY_THRESHOLD ||
        hypothesis.currentProbability <= 1 - FRAGILE_CERTAINTY_QUERY_PROBABILITY_THRESHOLD) &&
      averageEvidenceRelevance !== undefined &&
      averageEvidenceConfidence !== undefined &&
      (averageEvidenceRelevance < FRAGILE_CERTAINTY_QUERY_QUALITY_THRESHOLD ||
        averageEvidenceConfidence < FRAGILE_CERTAINTY_QUERY_QUALITY_THRESHOLD);
    const fragileCertaintyBoost = fragileCertainty ? FRAGILE_CERTAINTY_QUERY_PRIORITY_BOOST : 0;
    const priority = Number(
      Math.min(1, basePriority + calibrationBoost + counterEvidenceBoost + staleEvidenceBoost + fragileCertaintyBoost).toFixed(3)
    );
    const uncertaintyReason = uncertainty >= 0.66 ? "high uncertainty" : uncertainty >= 0.33 ? "moderate uncertainty" : "low uncertainty";
    const evidenceReason = coverage.evidenceCount === 0 ? "no active evidence" : `${coverage.evidenceCount} active evidence`;
    const priorityReasons = [uncertaintyReason, evidenceReason];
    if (calibrationPressure) {
      priorityReasons.push(`calibration error ${(calibrationPressure.error * 100).toFixed(1)}pp`);
    }
    if (counterEvidenceGap) {
      priorityReasons.push("needs counter-evidence");
    }
    if (staleDays !== undefined) {
      priorityReasons.push(`evidence stale ${staleDays}d`);
    }
    if (fragileCertainty) {
      priorityReasons.push("weak evidence quality");
    }

    return {
      priority,
      priorityReason: priorityReasons.join("; "),
      uncertainty: Number(uncertainty.toFixed(3)),
      evidenceCount: coverage.evidenceCount,
      supportEvidenceCount,
      opposingEvidenceCount,
      ...(counterEvidenceGap ? { counterEvidenceGap } : {}),
      ...(staleDays !== undefined ? { staleEvidenceDays: staleDays } : {}),
      ...(averageEvidenceRelevance !== undefined ? { averageEvidenceRelevance: Number(averageEvidenceRelevance.toFixed(3)) } : {}),
      ...(averageEvidenceConfidence !== undefined ? { averageEvidenceConfidence: Number(averageEvidenceConfidence.toFixed(3)) } : {}),
      ...(fragileCertainty ? { fragileCertainty } : {}),
      ...(coverage.latestEvidenceAt ? { latestEvidenceAt: coverage.latestEvidenceAt } : {}),
      ...(calibrationPressure
        ? {
            calibrationError: Number(calibrationPressure.error.toFixed(3)),
            calibrationHypothesisId: calibrationPressure.hypothesisId,
            ...(calibrationPressure.hypothesisCode ? { calibrationHypothesisCode: calibrationPressure.hypothesisCode } : {})
          }
        : {})
    };
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
        const query = settlementDue ? hypothesisSettlementSearchQuery(belief, hypothesis) : hypothesisEvidenceSearchQuery(belief, hypothesis);
        const key = `${hypothesis.id}:${query}`;
        if (!query || seen.has(key)) continue;
        seen.add(key);
        const coverage = evidenceCoverage.get(hypothesis.id) ?? {
          evidenceCount: 0,
          supportEvidenceCount: 0,
          opposingEvidenceCount: 0,
          relevanceSum: 0,
          confidenceSum: 0,
          linkCount: 0
        };
        const calibration = calibrationPressure.get(belief.id);
        queries.push({
          beliefId: belief.id,
          beliefCode: readableCode(beliefCodes, belief.id, "B"),
          hypothesisId: hypothesis.id,
          hypothesisCode: readableCode(hypothesisCodes, hypothesis.id, "H"),
          category: belief.category,
          query,
          ...(settlementDue
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
              })
        });
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
    const missingPresets = listSourcePresets(await store.listSources()).filter((preset) => !preset.installed);
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
      runOptions.queries ??
      (sourceSupportsGeneratedQueries(source)
        ? await generateEvidenceLoopQueries({
            beliefIds: runOptions.beliefIds,
            maxQueries: runOptions.maxQueries
          })
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
      const autoApplyPolicy = await applyAutoApplyPolicy({
        reviewOnly: runOptions.reviewOnly,
        autoConfirm: runOptions.forceAutoApply || source.autoConfirm,
        beliefIds: runOptions.beliefIds,
        sourceIds: [source.id]
      });

      for (const rawObservation of rawObservations) {
        const observation = await createObservation({
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
          continue;
        }

        const processed = await processCandidateObservation(observation, {
          candidateThreshold,
          autoApplyThreshold,
          autoConfirm: autoApplyPolicy.autoConfirm,
          reviewOnly: autoApplyPolicy.reviewOnly,
          reviewReason: autoApplyPolicy.reviewReason,
          beliefIds: beliefIds.size > 0 ? beliefIds : undefined
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

    for (const observation of selected) {
      const source = observation.sourceId ? await store.getSource(observation.sourceId) : null;
      const autoApplyThreshold = normalizedThreshold(loopOptions.autoConfirmThreshold, source?.autoConfirmThreshold ?? 0.8);
      const candidateThreshold = normalizedThreshold(
        loopOptions.candidateThreshold,
        Math.min(autoApplyThreshold, DEFAULT_CANDIDATE_THRESHOLD)
      );
      const autoApplyPolicy = await applyAutoApplyPolicy({
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
        beliefIds: beliefIds.size > 0 ? beliefIds : undefined
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
          queries
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

  async function recordAutomationHeartbeat(
    input: Omit<AutomationHeartbeatRecord, "createdAt" | "updatedAt">
  ): Promise<AutomationHeartbeatRecord> {
    const parsed = automationHeartbeatSchema.parse(input);
    const timestamp = now();
    const existing = (await store.listAutomationHeartbeats()).find((heartbeat) => heartbeat.id === parsed.id);

    return store.upsertAutomationHeartbeat({
      id: parsed.id,
      status: parsed.status,
      heartbeatAt: parsed.heartbeatAt,
      nextRunAt: parsed.nextRunAt,
      intervalMs: parsed.intervalMs,
      consecutiveFailureCount: parsed.consecutiveFailureCount,
      lastNotice: parsed.lastNotice?.trim() ?? "",
      lastError: parsed.lastError?.trim() ?? "",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
  }

  async function saveAutomationWorkerConfig(
    input: Omit<AutomationWorkerConfigRecord, "createdAt" | "updatedAt">
  ): Promise<AutomationWorkerConfigRecord> {
    const parsed = automationWorkerConfigSchema.parse(input);
    const timestamp = now();
    const existing = (await store.listAutomationWorkerConfigs()).find((config) => config.id === parsed.id);

    return store.upsertAutomationWorkerConfig({
      ...parsed,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
  }

  return {
    beliefs: {
      async createBelief(input) {
        const parsed = parseBeliefInput(input);
        const createdAt = now();
        const beliefId = createRecordId("belief");
        const hypotheses = createHypotheses(parsed, beliefId);
        const belief = await store.createBelief(
          {
            id: beliefId,
            title: parsed.title.trim(),
            category: parsed.category,
            description: parsed.description,
            probabilityMode: parsed.probabilityMode,
            status: "ACTIVE",
            createdAt,
            updatedAt: createdAt
          },
          hypotheses
        );
        await requeueSourceObservationForRecommendedHypotheses(parsed.sourceObservationId, belief.hypotheses, (hypothesis) =>
          hypothesis.stance === "OPPOSES" ? "OPPOSES" : "SUPPORTS"
        );
        return belief;
      },
      updateBelief: updateBeliefRecord,
      async createHypothesis(beliefId: string, input: CreateHypothesisInput) {
        const belief = await store.getBelief(beliefId);
        if (!belief) throw new Error(`Belief not found: ${beliefId}`);
        const parsed = createHypothesisSchema.parse(input);
        const createdAt = now();
        const hypothesis = await store.createHypothesis({
          id: createRecordId("hypothesis"),
          beliefId,
          proposition: parsed.proposition.trim(),
          notes: parsed.notes ?? "",
          evidenceSearchQuery: parsed.evidenceSearchQuery?.trim() ?? "",
          stance: parsed.stance,
          priorProbability: parsed.priorProbability,
          currentProbability: parsed.currentProbability ?? parsed.priorProbability,
          strength: parsed.currentProbability ?? parsed.priorProbability,
          status: "ACTIVE",
          startsAt: parsed.startsAt,
          expiresAt: parsed.expiresAt,
          expiryCondition: parsed.expiryCondition,
          createdAt,
          updatedAt: createdAt
        });

        let finalHypothesis = hypothesis;
        if (belief.probabilityMode === "MUTUALLY_EXCLUSIVE") {
          const updatedBelief = await store.getBelief(beliefId);
          if (updatedBelief) {
            const probabilities = normalizeMutuallyExclusive(
              updatedBelief.hypotheses.map((item) => item.currentProbability)
            );
            await store.updateHypothesisProbabilities(
                Object.fromEntries(updatedBelief.hypotheses.map((item, index) => [item.id, probabilities[index]]))
            );
          }
          finalHypothesis = (await store.getHypothesis(hypothesis.id)) ?? hypothesis;
        }

        await requeueSourceObservationForRecommendedHypothesis(parsed.sourceObservationId, finalHypothesis);
        await requeueUnmatchedObservationsForHypothesis(finalHypothesis);
        return finalHypothesis;
      },
      updateHypothesis: updateHypothesisRecord,
      async recommendHypotheses(beliefId: string, recommendationOptions: HypothesisRecommendationOptions = {}) {
        const belief = await store.getBelief(beliefId);
        if (!belief) throw new Error(`Belief not found: ${beliefId}`);
        const observations = await store.listObservations();
        const scopedObservations = recommendationOptions.sourceObservationId
          ? observations.filter((observation) => observation.id === recommendationOptions.sourceObservationId)
          : observations;
        return createHypothesisRecommendations(
          belief,
          recommendationOptions,
          scopedObservations,
          options.hypothesisRecommendationGenerator
        );
      },
      listBeliefs() {
        return store.listBeliefs();
      },
      getBelief(id) {
        return store.getBelief(id);
      }
    },
    observations: {
      createObservation,
      updateObservation,
      rejectObservation,
      settleObservation,
      listObservations() {
        return store.listObservations();
      }
    },
    evidence: {
      confirmObservation,
      confirmAndApplyObservation,
      updateAndReapply: updateAndReapplyEvidence,
      connectHypothesis: connectEvidenceHypothesis,
      disconnectHypothesis: disconnectEvidenceHypothesis,
      reject: rejectEvidence,
      deleteEvidence,
      listEvidence() {
        return listVisibleEvidence();
      }
    },
    likelihood: {
      async runLikelihood(input: RunLikelihoodInput) {
        const evidence = await store.getEvidence(input.evidenceId);
        if (!evidence) throw new Error(`Evidence not found: ${input.evidenceId}`);
        const hypothesis = await store.getHypothesis(input.hypothesisId);
        if (!hypothesis) throw new Error(`Hypothesis not found: ${input.hypothesisId}`);
        const ensemble = combineEstimatorOutputs(input.outputs);
        return store.createLikelihoodRun({
          id: createRecordId("likelihood"),
          evidenceId: input.evidenceId,
          hypothesisId: input.hypothesisId,
          ensembleLikelihoodRatio: ensemble.likelihoodRatio,
          ensembleConfidence: ensemble.confidence,
          estimatorOutputs: input.outputs,
          modelVersion: ensemble.modelVersion,
          createdAt: now()
        });
      },
      listRuns() {
        return store.listLikelihoodRuns();
      }
    },
    updates: {
      listEvents() {
        return store.listUpdateEvents();
      },
      createPreview,
      createPreviews,
      applyPreview,
      applyEvidence: applyEvidenceUpdates,
      async rollback(eventId: string) {
        return rollbackEvent(eventId);
      }
    },
    sources: {
      listSources() {
        return store.listSources();
      },
      listRuns() {
        return store.listObservationRuns();
      },
      async listPresets() {
        return listSourcePresets(await store.listSources());
      },
      async createPreset(id: string) {
        return createSourcePresetRecord(id);
      },
      async createMissingPresets() {
        return createMissingSourcePresetRecords();
      },
      async createSource(input: CreateSourceInput) {
        const parsed = sourceSchema.parse(input);
        const createdAt = now();
        return store.createSource({
          id: createRecordId("source"),
          ...parsed,
          createdAt,
          updatedAt: createdAt
        });
      },
      async updateSource(id: string, input: UpdateSourceInput) {
        const parsed = updateSourceSchema.parse(input);
        return store.updateSource(id, { ...parsed, updatedAt: now() });
      },
      async runDryRun(sourceId: string, observations: RawObservationInput[], runOptions: RunDryRunOptions = {}) {
        const source = await store.getSource(sourceId);
        if (!source) throw new Error(`Source not found: ${sourceId}`);
        const querySummary = runOptions.queries ?? [];
        const seen: ObservationForDedupe[] = [];
        let deduplicatedCount = 0;
        for (const observation of observations) {
          const decision = deduplicateObservation(toDedupeObservation(observation), seen);
          if (decision.duplicate) deduplicatedCount += 1;
          seen.push({ id: createRecordId("dry_observation"), ...toDedupeObservation(observation) });
        }
        const startedAt = now();
        return createObservationRunRecord({
          id: createRecordId("observation_run"),
          sourceId,
          status: "DRY_RUN",
          startedAt,
          finishedAt: now(),
          itemCount: observations.length,
          reprocessedObservationCount: 0,
          deduplicatedCount,
          candidateCount: 0,
          autoAppliedCount: 0,
          reviewCount: 0,
          lowImpactCount: 0,
          unmatchedCount: 0,
          queryCount: querySummary.length,
          querySummary
        });
      },
      async runSource(sourceId: string, runOptions: RunSourceOptions = {}) {
        return runSource(sourceId, runOptions);
      }
    },
    automation: {
      runEvidenceLoop,
      recordHeartbeat: recordAutomationHeartbeat,
      listHeartbeats() {
        return store.listAutomationHeartbeats();
      },
      saveWorkerConfig: saveAutomationWorkerConfig,
      listWorkerConfigs() {
        return store.listAutomationWorkerConfigs();
      }
    },
    models: {
      listArtifacts() {
        return store.listModelArtifacts();
      },
      async importArtifact(input: ImportArtifactInput) {
        const parsed = artifactSchema.parse(input);
        assertImportableModelArtifact(parsed);
        return store.createModelArtifact({
          id: createRecordId("model"),
          ...parsed,
          createdAt: now()
        });
      }
    }
  };
}
