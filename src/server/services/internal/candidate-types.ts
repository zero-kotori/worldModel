import type { ConfirmEvidenceInput, ObservationCleanupMode } from "@/server/services/types";

export type CandidateEvaluationMetadata = {
  estimator: string;
  attemptedCount: number;
  usableCount: number;
  abstainedCount: number;
  rejectedCount: number;
  latestRationale?: string;
};

export type EvidenceLinkRecommendationResult = {
  links: ConfirmEvidenceInput["links"];
  candidateEvaluation?: CandidateEvaluationMetadata;
};

export type EvidenceLinkRecommendationOptions = {
  beliefIds?: ReadonlySet<string>;
};

export type CandidateObservationProcessingOptions = {
  candidateThreshold: number;
  autoApplyThreshold: number;
  autoConfirm: boolean;
  reviewOnly?: boolean;
  reviewReason?: string;
  beliefIds?: ReadonlySet<string>;
  duplicateObservationCleanup?: ObservationCleanupMode;
  unmatchedObservationCleanup?: ObservationCleanupMode;
  lowImpactObservationCleanup?: ObservationCleanupMode;
};

export type CandidateObservationProcessingResult = {
  candidateCount: number;
  autoAppliedCount: number;
  reviewCount: number;
  lowImpactCount: number;
  unmatchedCount: number;
  failureCount: number;
  errorMessages: string[];
};
