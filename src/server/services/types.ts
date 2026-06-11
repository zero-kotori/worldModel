import type { EstimatorOutput } from "@/domain/likelihood";
import type { ProbabilityMode, ProbabilitySnapshot, UpdatePreview } from "@/domain/updates";

export type BeliefCategory = "AI_TREND" | "INVESTMENT" | "TECH_TREND" | "CAREER" | "SOURCE_RELIABILITY";
export type BeliefStatus = "ACTIVE" | "PAUSED" | "ARCHIVED";
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
export type ObservationStatus = "PENDING" | "DUPLICATE" | "UNKNOWN" | "CONFIRMED" | "REJECTED";
export type EvidenceConfirmationMode = "MANUAL" | "AUTO";
export type EvidenceStatus = "ACTIVE" | "SUPERSEDED" | "REJECTED";
export type EvidenceDirection = "SUPPORTS" | "OPPOSES" | "MIXED" | "NEUTRAL";
export type ObservationRunStatus = "SUCCESS" | "FAILED" | "DRY_RUN" | "REVIEW_ONLY";
export type ModelArtifactKind = "LIGHTWEIGHT" | "LLM" | "DEEP_ADAPTER";

export type HypothesisRecord = {
  id: string;
  beliefId: string;
  proposition: string;
  notes: string;
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
  status: ObservationRunStatus;
  startedAt: Date;
  finishedAt?: Date;
  itemCount: number;
  deduplicatedCount: number;
  candidateCount: number;
  autoAppliedCount: number;
  reviewCount: number;
  queryCount: number;
  querySummary: EvidenceLoopQuery[];
  errorMessage?: string;
};

export type RunSourceOptions = {
  reviewOnly?: boolean;
  autoConfirmThreshold?: number;
  maxObservations?: number;
  queries?: EvidenceLoopQuery[];
};

export type EvidenceLoopQuery = {
  beliefId: string;
  hypothesisId: string;
  category: BeliefCategory;
  query: string;
};

export type EvidenceLoopOptions = {
  reviewOnly?: boolean;
  beliefIds?: string[];
  sourceIds?: string[];
  autoConfirmThreshold?: number;
  maxObservations?: number;
  bootstrapDefaultSources?: boolean;
};

export type EvidenceLoopResult = {
  mode: "auto-apply" | "review-only";
  queryCount: number;
  sourceRunCount: number;
  itemCount: number;
  deduplicatedCount: number;
  candidateCount: number;
  autoAppliedCount: number;
  reviewCount: number;
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
  stance?: HypothesisStance;
  notes?: string;
  startsAt?: Date;
  expiresAt?: Date;
  expiryCondition?: string;
};

export type HypothesisRecommendation = Required<Pick<CreateHypothesisInput, "proposition" | "priorProbability" | "stance" | "notes">> & {
  evidenceSearchQuery: string;
  rationale: string;
};

export type HypothesisRecommendationOptions = {
  limit?: number;
};

export type CreateBeliefInput = {
  title: string;
  category: BeliefCategory;
  description: string;
  probabilityMode: ProbabilityMode;
  hypotheses: CreateHypothesisInput[];
};

export type UpdateBeliefInput = Partial<Pick<BeliefRecord, "title" | "category" | "description" | "probabilityMode" | "status">>;

export type UpdateHypothesisInput = Partial<
  Pick<
    HypothesisRecord,
    | "beliefId"
    | "proposition"
    | "notes"
    | "stance"
    | "priorProbability"
    | "currentProbability"
    | "status"
    | "startsAt"
    | "expiresAt"
    | "expiryCondition"
  >
>;

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

export type UpdateEvidenceRecordInput = Partial<Omit<EvidenceRecord, "id" | "observationId" | "confirmedAt" | "links">> & {
  links?: EvidenceHypothesisLinkRecord[];
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
  event: BayesianUpdateEventRecord;
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
  createUpdateEvent(input: BayesianUpdateEventRecord): Promise<BayesianUpdateEventRecord>;
  listUpdateEvents(): Promise<BayesianUpdateEventRecord[]>;
  getUpdateEvent(id: string): Promise<BayesianUpdateEventRecord | null>;
  updateUpdateEvent(id: string, patch: Partial<BayesianUpdateEventRecord>): Promise<BayesianUpdateEventRecord>;
  createSource(input: ObservationSourceRecord): Promise<ObservationSourceRecord>;
  listSources(): Promise<ObservationSourceRecord[]>;
  getSource(id: string): Promise<ObservationSourceRecord | null>;
  createObservationRun(input: ObservationRunRecord): Promise<ObservationRunRecord>;
  listObservationRuns(): Promise<ObservationRunRecord[]>;
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
    rejectObservation(id: string): Promise<ObservationRecord>;
    listObservations(): Promise<ObservationRecord[]>;
  };
  evidence: {
    confirmObservation(input: ConfirmEvidenceInput): Promise<EvidenceRecord>;
    confirmAndApplyObservation(input: ConfirmEvidenceInput): Promise<ConfirmAndApplyEvidenceResult>;
    updateAndReapply(evidenceId: string, input: UpdateEvidenceInput): Promise<ConfirmAndApplyEvidenceResult>;
    connectHypothesis(evidenceId: string, input: ConnectEvidenceHypothesisInput): Promise<ConfirmAndApplyEvidenceResult>;
    reject(evidenceId: string): Promise<EvidenceRecord>;
    listEvidence(): Promise<EvidenceRecord[]>;
  };
  likelihood: {
    runLikelihood(input: RunLikelihoodInput): Promise<LikelihoodRunRecord>;
  };
  updates: {
    listEvents(): Promise<BayesianUpdateEventRecord[]>;
    createPreview(evidenceId: string): Promise<UpdatePreview>;
    applyPreview(preview: UpdatePreview, likelihoodRunId?: string): Promise<BayesianUpdateEventRecord>;
    rollback(eventId: string): Promise<BayesianUpdateEventRecord & { restoredProbabilities: ProbabilitySnapshot }>;
  };
  sources: {
    listSources(): Promise<ObservationSourceRecord[]>;
    listPresets(): Promise<SourcePresetRecord[]>;
    createPreset(id: string): Promise<ObservationSourceRecord>;
    createSource(input: CreateSourceInput): Promise<ObservationSourceRecord>;
    runDryRun(sourceId: string, observations: RawObservationInput[]): Promise<ObservationRunRecord>;
    runSource(sourceId: string, options?: RunSourceOptions): Promise<ObservationRunRecord>;
    listRuns(): Promise<ObservationRunRecord[]>;
  };
  automation: {
    runEvidenceLoop(options?: EvidenceLoopOptions): Promise<EvidenceLoopResult>;
  };
  models: {
    listArtifacts(): Promise<ModelArtifactRecord[]>;
    importArtifact(input: ImportArtifactInput): Promise<ModelArtifactRecord>;
  };
};
