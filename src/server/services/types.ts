import type { EstimatorOutput } from "@/domain/likelihood";
import type { ProbabilityMode, ProbabilitySnapshot, UpdatePreview } from "@/domain/updates";

export type BeliefCategory = "AI_TREND" | "INVESTMENT" | "TECH_TREND" | "CAREER" | "SOURCE_RELIABILITY";
export type BeliefStatus = "ACTIVE" | "PAUSED" | "ARCHIVED";
export type BeliefOrigin = "INTERNAL" | "EXTERNAL";
export type HypothesisStatus = "ACTIVE" | "PAUSED" | "RESOLVED_TRUE" | "RESOLVED_FALSE" | "ARCHIVED";
export type HypothesisStance = "SUPPORTS" | "OPPOSES";
export type ObservationSourceKind =
  | "MANUAL"
  | "RSS"
  | "WEB_PAGE"
  | "SEARCH"
  | "GITHUB"
  | "HUGGING_FACE"
  | "GDELT"
  | "PREDICTION_MARKET"
  | "SOCIAL";
export type ObservationStatus = "PENDING" | "DUPLICATE" | "UNKNOWN" | "CONFIRMED" | "REJECTED" | "DELETED" | "SETTLED";
export type ObservationCleanupMode = "KEEP" | "REJECT" | "DELETE";
export type EvidenceConfirmationMode = "MANUAL" | "AUTO";
export type EvidenceStatus = "ACTIVE" | "SUPERSEDED" | "REJECTED" | "DELETED";
export type EvidenceDirection = "SUPPORTS" | "OPPOSES" | "MIXED" | "NEUTRAL";
export type ObservationRunStatus = "SUCCESS" | "FAILED" | "DRY_RUN" | "REVIEW_ONLY";
export type ModelArtifactKind = "LIGHTWEIGHT" | "LLM" | "DEEP_ADAPTER";
export type AutomationHeartbeatStatus = "RUNNING" | "IDLE" | "ERROR";

export type HypothesisRecord = {
  id: string;
  beliefId: string;
  proposition: string;
  notes: string;
  evidenceSearchQuery?: string;
  stance: HypothesisStance;
  priorProbability: number;
  currentProbability: number;
  strength: number;
  status: HypothesisStatus;
  startsAt?: Date;
  expiresAt?: Date;
  expiryCondition?: string;
  resolvedOutcome?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type BeliefRecord = {
  id: string;
  title: string;
  category: BeliefCategory;
  description: string;
  probabilityMode: ProbabilityMode;
  origin: BeliefOrigin;
  status: BeliefStatus;
  hypotheses: HypothesisRecord[];
  createdAt: Date;
  updatedAt: Date;
};

export type ObservationSourceRecord = {
  id: string;
  name: string;
  kind: ObservationSourceKind;
  url?: string;
  adapter: string;
  credentialRef?: string;
  credibility: number;
  enabled: boolean;
  autoConfirm: boolean;
  autoConfirmThreshold: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ObservationRecord = {
  id: string;
  sourceId?: string;
  title: string;
  content: string;
  url?: string;
  author?: string;
  publishedAt?: Date;
  observedAt: Date;
  normalizedHash?: string;
  semanticKey?: string;
  status: ObservationStatus;
  duplicateOfId?: string;
  credibility: number;
  metadata: Record<string, unknown>;
};

export type EvidenceHypothesisLinkRecord = {
  id: string;
  evidenceId: string;
  hypothesisId: string;
  direction: EvidenceDirection;
  relevance: number;
  likelihoodRatio: number;
  confidence: number;
  rationale: string;
  createdAt: Date;
};

export type EvidenceRecord = {
  id: string;
  observationId: string;
  title: string;
  content: string;
  url?: string;
  confirmedAt: Date;
  confirmationMode: EvidenceConfirmationMode;
  credibility: number;
  status: EvidenceStatus;
  metadata: Record<string, unknown>;
  links: EvidenceHypothesisLinkRecord[];
};

export type LikelihoodRunRecord = {
  id: string;
  evidenceId: string;
  hypothesisId: string;
  ensembleLikelihoodRatio: number;
  ensembleConfidence: number;
  estimatorOutputs: EstimatorOutput[];
  modelVersion: string;
  createdAt: Date;
};

export type BayesianUpdateEventRecord = {
  id: string;
  beliefId: string;
  evidenceId: string;
  likelihoodRunId?: string;
  likelihoodRunIds?: string[];
  priorSnapshot: ProbabilitySnapshot;
  posteriorSnapshot: ProbabilitySnapshot;
  mode: "APPLIED";
  status: "APPLIED" | "ROLLED_BACK";
  confidence: number;
  explanations: string[];
  createdAt: Date;
  rolledBackAt?: Date;
};

export type ObservationRunRecord = {
  id: string;
  sourceId?: string;
  sourceCode?: string;
  status: ObservationRunStatus;
  startedAt: Date;
  finishedAt?: Date;
  itemCount: number;
  reprocessedObservationCount: number;
  deduplicatedCount: number;
  candidateCount: number;
  autoAppliedCount: number;
  reviewCount: number;
  lowImpactCount: number;
  unmatchedCount: number;
  queryCount: number;
  querySummary: EvidenceLoopQuery[];
  errorMessage?: string;
};

export type AutomationHeartbeatRecord = {
  id: string;
  status: AutomationHeartbeatStatus;
  heartbeatAt: Date;
  nextRunAt?: Date;
  intervalMs: number;
  consecutiveFailureCount: number;
  lastNotice: string;
  lastError: string;
  createdAt: Date;
  updatedAt: Date;
};

export type AutomationWorkerConfigRecord = {
  id: string;
  enabled: boolean;
  intervalMs: number;
  failureBackoffMultiplier: number;
  maxIntervalMs: number;
  reviewOnly: boolean;
  maxQueries?: number;
  maxSources?: number;
  beliefIds?: string[];
  sourceIds?: string[];
  maxObservations?: number;
  candidateThreshold?: number;
  autoConfirmThreshold?: number;
  bootstrapDefaultSources: boolean;
  forceAutoApply: boolean;
  duplicateObservationCleanup?: ObservationCleanupMode;
  unmatchedObservationCleanup?: ObservationCleanupMode;
  lowImpactObservationCleanup?: ObservationCleanupMode;
  createdAt: Date;
  updatedAt: Date;
};

export type RunSourceOptions = {
  reviewOnly?: boolean;
  forceAutoApply?: boolean;
  beliefIds?: string[];
  candidateThreshold?: number;
  autoConfirmThreshold?: number;
  maxQueries?: number;
  maxObservations?: number;
  queries?: EvidenceLoopQuery[];
  duplicateObservationCleanup?: ObservationCleanupMode;
  unmatchedObservationCleanup?: ObservationCleanupMode;
  lowImpactObservationCleanup?: ObservationCleanupMode;
};

export type RunDryRunOptions = {
  queries?: EvidenceLoopQuery[];
};

export type EvidenceLoopQuery = {
  beliefId: string;
  beliefCode?: string;
  hypothesisId: string;
  hypothesisCode?: string;
  category: BeliefCategory;
  purpose?: "EVIDENCE" | "SETTLEMENT_REVIEW";
  query: string;
  plannerStrategy?: "LLM" | "MANUAL" | "RULE_BASE" | "RULE_COMPARISON" | "SETTLEMENT";
  plannerPurpose?: "GENERAL" | "PREDICTION_MARKET";
  plannerRank?: number;
  baseQuery?: string;
  sourceKinds?: ObservationSourceKind[];
  priority?: number;
  priorityReason?: string;
  uncertainty?: number;
  evidenceCount?: number;
  supportEvidenceCount?: number;
  opposingEvidenceCount?: number;
  counterEvidenceGap?: boolean;
  staleEvidenceDays?: number;
  averageEvidenceRelevance?: number;
  averageEvidenceConfidence?: number;
  fragileCertainty?: boolean;
  latestEvidenceAt?: string;
  calibrationError?: number;
  calibrationHypothesisId?: string;
  calibrationHypothesisCode?: string;
  settlementDue?: boolean;
  expiresAt?: string;
  expiryCondition?: string;
};

export type EvidenceLoopOptions = {
  reviewOnly?: boolean;
  beliefIds?: string[];
  sourceIds?: string[];
  candidateThreshold?: number;
  autoConfirmThreshold?: number;
  maxQueries?: number;
  maxObservations?: number;
  maxSources?: number;
  bootstrapDefaultSources?: boolean;
  forceAutoApply?: boolean;
  duplicateObservationCleanup?: ObservationCleanupMode;
  unmatchedObservationCleanup?: ObservationCleanupMode;
  lowImpactObservationCleanup?: ObservationCleanupMode;
};

export type EvidenceLoopSkippedSource =
  | {
      sourceId: string;
      sourceCode?: string;
      sourceName: string;
      reason: "CONSECUTIVE_FAILURES";
      consecutiveFailureCount: number;
      latestError?: string;
      retryAfterAt?: Date;
    }
  | {
      sourceId: string;
      sourceCode?: string;
      sourceName: string;
      reason: "LOW_INCREMENT";
      consecutiveDuplicateOnlyCount: number;
      retryAfterAt?: Date;
    };

export type EvidenceLoopResult = {
  mode: "auto-apply" | "review-only";
  queryCount: number;
  sourceRunCount: number;
  skippedSourceCount: number;
  skippedSources: EvidenceLoopSkippedSource[];
  itemCount: number;
  reprocessedObservationCount: number;
  deduplicatedCount: number;
  candidateCount: number;
  autoAppliedCount: number;
  reviewCount: number;
  lowImpactCount: number;
  unmatchedCount: number;
  failureCount: number;
  queries: EvidenceLoopQuery[];
  runs: ObservationRunRecord[];
};

export type ModelArtifactRecord = {
  id: string;
  name: string;
  kind: ModelArtifactKind;
  version: string;
  path: string;
  metrics: Record<string, unknown>;
  enabled: boolean;
  createdAt: Date;
};

export type CreateHypothesisInput = {
  proposition: string;
  priorProbability: number;
  currentProbability?: number;
  stance?: HypothesisStance;
  notes?: string;
  evidenceSearchQuery?: string;
  startsAt?: Date;
  expiresAt?: Date;
  expiryCondition?: string;
  sourceObservationId?: string;
};

export type HypothesisRecommendation = Required<Pick<CreateHypothesisInput, "proposition" | "priorProbability" | "stance" | "notes">> & {
  evidenceSearchQuery: string;
  rationale: string;
  sourceObservationId?: string;
  calibrationHypothesisId?: string;
  calibrationError?: number;
};

export type HypothesisRecommendationGeneratorInput = {
  belief: BeliefRecord;
  calibration?: {
    hypothesis: HypothesisRecord;
    outcome: 0 | 1;
    predictedProbability: number;
    error: number;
    resolvedOutcome?: string;
  };
  sourceObservation?: ObservationRecord;
  limit: number;
};

export type HypothesisRecommendationGenerator = (
  input: HypothesisRecommendationGeneratorInput
) => Promise<HypothesisRecommendation[]>;

export type HypothesisRecommendationOptions = {
  limit?: number;
  sourceObservationId?: string;
};

export type CreateBeliefInput = {
  title: string;
  category: BeliefCategory;
  description: string;
  probabilityMode: ProbabilityMode;
  origin?: BeliefOrigin;
  sourceObservationId?: string;
  hypotheses: CreateHypothesisInput[];
};

export type UpdateBeliefInput = Partial<Pick<BeliefRecord, "title" | "category" | "description" | "probabilityMode" | "status">>;

export type UpdateHypothesisInput = Partial<
  Pick<
    HypothesisRecord,
    | "beliefId"
    | "proposition"
    | "notes"
    | "evidenceSearchQuery"
    | "stance"
    | "priorProbability"
    | "currentProbability"
    | "status"
    | "expiryCondition"
    | "resolvedOutcome"
  >
> & {
  startsAt?: Date | null;
  expiresAt?: Date | null;
};

export type CreateObservationInput = {
  sourceId?: string;
  title: string;
  content: string;
  url?: string;
  author?: string;
  publishedAt?: Date;
  credibility?: number;
  normalizedHash?: string;
  semanticKey?: string;
  metadata?: Record<string, unknown>;
};

export type UpdateObservationInput = Partial<{
  sourceId?: string | null;
  title: string;
  content: string;
  url?: string;
  author?: string;
  credibility: number;
  normalizedHash?: string;
  semanticKey?: string;
  metadata: Record<string, unknown>;
}>;

export type SettleObservationInput = {
  observationId: string;
  hypothesisId: string;
  outcome: "RESOLVED_TRUE" | "RESOLVED_FALSE";
  resolvedOutcome?: string;
};

export type SettleObservationResult = {
  observation: ObservationRecord;
  hypothesis: HypothesisRecord;
};

export type ConfirmEvidenceInput = {
  observationId: string;
  confirmationMode: EvidenceConfirmationMode;
  links: Array<{
    hypothesisId: string;
    direction: EvidenceDirection;
    relevance: number;
    likelihoodRatio: number;
    confidence: number;
    rationale: string;
    reviewRequired?: boolean;
    estimatorOutputs?: EstimatorOutput[];
  }>;
};

export type UpdateEvidenceInput = {
  title?: string;
  content?: string;
  url?: string;
  credibility?: number;
  metadata?: Record<string, unknown>;
  links?: Array<{
    hypothesisId: string;
    direction: EvidenceDirection;
    relevance: number;
    likelihoodRatio: number;
    confidence: number;
    rationale: string;
    reviewRequired?: boolean;
    estimatorOutputs?: EstimatorOutput[];
  }>;
};

export type ConnectEvidenceHypothesisInput = {
  hypothesisId: string;
  direction: EvidenceDirection;
  relevance: number;
  likelihoodRatio: number;
  confidence: number;
  rationale: string;
};

export type DisconnectEvidenceHypothesisInput = {
  hypothesisId: string;
};

export type UpdateEvidenceRecordInput = Partial<Omit<EvidenceRecord, "id" | "observationId" | "links">> & {
  links?: EvidenceHypothesisLinkRecord[];
};
export type UpdateSourceInput = Partial<CreateSourceInput>;
export type UpdateSourceRecordInput = Partial<Omit<ObservationSourceRecord, "id" | "createdAt">> & {
  updatedAt: Date;
};

export type RunLikelihoodInput = {
  evidenceId: string;
  hypothesisId: string;
  outputs: EstimatorOutput[];
};

export type CreateSourceInput = Omit<ObservationSourceRecord, "id" | "createdAt" | "updatedAt">;
export type RawObservationInput = Pick<CreateObservationInput, "title" | "content" | "url" | "author" | "publishedAt">;
export type ImportArtifactInput = Omit<ModelArtifactRecord, "id" | "createdAt">;

export type SourcePresetRecord = CreateSourceInput & {
  id: string;
  description: string;
  installed: boolean;
};

export type ConfirmAndApplyEvidenceResult = {
  evidence: EvidenceRecord;
  event: BayesianUpdateEventRecord | null;
  events: BayesianUpdateEventRecord[];
};

export type WorldModelStore = {
  createBelief(input: Omit<BeliefRecord, "hypotheses">, hypotheses: HypothesisRecord[]): Promise<BeliefRecord>;
  updateBelief(id: string, patch: UpdateBeliefInput & { updatedAt: Date }): Promise<BeliefRecord>;
  createHypothesis(input: HypothesisRecord): Promise<HypothesisRecord>;
  updateHypothesis(id: string, patch: UpdateHypothesisInput & { updatedAt: Date }): Promise<HypothesisRecord>;
  listBeliefs(): Promise<BeliefRecord[]>;
  getBelief(id: string): Promise<BeliefRecord | null>;
  getHypothesis(id: string): Promise<HypothesisRecord | null>;
  updateHypothesisProbabilities(probabilities: ProbabilitySnapshot): Promise<void>;
  createObservation(input: ObservationRecord): Promise<ObservationRecord>;
  listObservations(): Promise<ObservationRecord[]>;
  getObservation(id: string): Promise<ObservationRecord | null>;
  updateObservation(id: string, patch: Partial<ObservationRecord>): Promise<ObservationRecord>;
  createEvidence(evidence: EvidenceRecord): Promise<EvidenceRecord>;
  getEvidence(id: string): Promise<EvidenceRecord | null>;
  listEvidence(): Promise<EvidenceRecord[]>;
  updateEvidence(id: string, patch: UpdateEvidenceRecordInput): Promise<EvidenceRecord>;
  createLikelihoodRun(input: LikelihoodRunRecord): Promise<LikelihoodRunRecord>;
  listLikelihoodRuns(): Promise<LikelihoodRunRecord[]>;
  createUpdateEvent(input: BayesianUpdateEventRecord): Promise<BayesianUpdateEventRecord>;
  listUpdateEvents(): Promise<BayesianUpdateEventRecord[]>;
  getUpdateEvent(id: string): Promise<BayesianUpdateEventRecord | null>;
  updateUpdateEvent(id: string, patch: Partial<BayesianUpdateEventRecord>): Promise<BayesianUpdateEventRecord>;
  createSource(input: ObservationSourceRecord): Promise<ObservationSourceRecord>;
  updateSource(id: string, patch: UpdateSourceRecordInput): Promise<ObservationSourceRecord>;
  listSources(): Promise<ObservationSourceRecord[]>;
  getSource(id: string): Promise<ObservationSourceRecord | null>;
  createObservationRun(input: ObservationRunRecord): Promise<ObservationRunRecord>;
  listObservationRuns(): Promise<ObservationRunRecord[]>;
  upsertAutomationHeartbeat(input: AutomationHeartbeatRecord): Promise<AutomationHeartbeatRecord>;
  listAutomationHeartbeats(): Promise<AutomationHeartbeatRecord[]>;
  upsertAutomationWorkerConfig(input: AutomationWorkerConfigRecord): Promise<AutomationWorkerConfigRecord>;
  listAutomationWorkerConfigs(): Promise<AutomationWorkerConfigRecord[]>;
  createModelArtifact(input: ModelArtifactRecord): Promise<ModelArtifactRecord>;
  listModelArtifacts(): Promise<ModelArtifactRecord[]>;
};

export type WorldModelServices = {
  beliefs: {
    createBelief(input: CreateBeliefInput): Promise<BeliefRecord>;
    updateBelief(id: string, input: UpdateBeliefInput): Promise<BeliefRecord>;
    createHypothesis(beliefId: string, input: CreateHypothesisInput): Promise<HypothesisRecord>;
    updateHypothesis(id: string, input: UpdateHypothesisInput): Promise<HypothesisRecord>;
    recommendHypotheses(id: string, options?: HypothesisRecommendationOptions): Promise<HypothesisRecommendation[]>;
    listBeliefs(): Promise<BeliefRecord[]>;
    getBelief(id: string): Promise<BeliefRecord | null>;
  };
  observations: {
    createObservation(input: CreateObservationInput): Promise<ObservationRecord>;
    updateObservation(id: string, input: UpdateObservationInput): Promise<ObservationRecord>;
    rejectObservation(id: string): Promise<ObservationRecord>;
    deleteObservation(id: string): Promise<ObservationRecord>;
    settleObservation(input: SettleObservationInput): Promise<SettleObservationResult>;
    listObservations(): Promise<ObservationRecord[]>;
  };
  evidence: {
    confirmObservation(input: ConfirmEvidenceInput): Promise<EvidenceRecord>;
    confirmAndApplyObservation(input: ConfirmEvidenceInput): Promise<ConfirmAndApplyEvidenceResult>;
    updateAndReapply(evidenceId: string, input: UpdateEvidenceInput): Promise<ConfirmAndApplyEvidenceResult>;
    connectHypothesis(evidenceId: string, input: ConnectEvidenceHypothesisInput): Promise<ConfirmAndApplyEvidenceResult>;
    disconnectHypothesis(evidenceId: string, input: DisconnectEvidenceHypothesisInput): Promise<ConfirmAndApplyEvidenceResult>;
    reject(evidenceId: string): Promise<EvidenceRecord>;
    deleteEvidence(evidenceId: string): Promise<EvidenceRecord>;
    listEvidence(): Promise<EvidenceRecord[]>;
  };
  likelihood: {
    runLikelihood(input: RunLikelihoodInput): Promise<LikelihoodRunRecord>;
    listRuns(): Promise<LikelihoodRunRecord[]>;
  };
  updates: {
    listEvents(): Promise<BayesianUpdateEventRecord[]>;
    createPreview(evidenceId: string): Promise<UpdatePreview>;
    createPreviews(evidenceId: string): Promise<UpdatePreview[]>;
    applyPreview(preview: UpdatePreview, likelihoodRunId?: string): Promise<BayesianUpdateEventRecord>;
    applyEvidence(evidenceId: string, likelihoodRunId?: string): Promise<BayesianUpdateEventRecord[]>;
    rollback(eventId: string): Promise<BayesianUpdateEventRecord & { restoredProbabilities: ProbabilitySnapshot }>;
  };
  sources: {
    listSources(): Promise<ObservationSourceRecord[]>;
    listPresets(): Promise<SourcePresetRecord[]>;
    createPreset(id: string): Promise<ObservationSourceRecord>;
    createMissingPresets(): Promise<ObservationSourceRecord[]>;
    createSource(input: CreateSourceInput): Promise<ObservationSourceRecord>;
    updateSource(id: string, input: UpdateSourceInput): Promise<ObservationSourceRecord>;
    runDryRun(sourceId: string, observations: RawObservationInput[], options?: RunDryRunOptions): Promise<ObservationRunRecord>;
    runSource(sourceId: string, options?: RunSourceOptions): Promise<ObservationRunRecord>;
    listRuns(): Promise<ObservationRunRecord[]>;
  };
  automation: {
    runEvidenceLoop(options?: EvidenceLoopOptions): Promise<EvidenceLoopResult>;
    recordHeartbeat(input: Omit<AutomationHeartbeatRecord, "createdAt" | "updatedAt">): Promise<AutomationHeartbeatRecord>;
    listHeartbeats(): Promise<AutomationHeartbeatRecord[]>;
    saveWorkerConfig(input: Omit<AutomationWorkerConfigRecord, "createdAt" | "updatedAt">): Promise<AutomationWorkerConfigRecord>;
    listWorkerConfigs(): Promise<AutomationWorkerConfigRecord[]>;
  };
  models: {
    listArtifacts(): Promise<ModelArtifactRecord[]>;
    importArtifact(input: ImportArtifactInput): Promise<ModelArtifactRecord>;
  };
};
