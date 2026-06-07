import { discountLikelihoodRatio, normalizeMutuallyExclusive, updateIndependentHypothesis } from "@/domain/bayes";

export type ProbabilityMode = "MUTUALLY_EXCLUSIVE" | "INDEPENDENT";

export type HypothesisForUpdate = {
  id: string;
  proposition: string;
  currentProbability: number;
  strength: number;
};

export type BeliefForUpdate = {
  id: string;
  probabilityMode: ProbabilityMode;
  hypotheses: HypothesisForUpdate[];
};

export type EvidenceLinkForUpdate = {
  hypothesisId: string;
  likelihoodRatio: number;
  credibility: number;
  confidence: number;
  rationale: string;
};

export type ProbabilitySnapshot = Record<string, number>;

export type UpdatePreview = {
  beliefId: string;
  mode: ProbabilityMode;
  priorSnapshot: ProbabilitySnapshot;
  posteriorSnapshot: ProbabilitySnapshot;
  links: EvidenceLinkForUpdate[];
  explanations: string[];
  reviewRequired: boolean;
  confidence: number;
};

export type AppliedUpdateEvent = {
  id: string;
  beliefId: string;
  priorSnapshot: ProbabilitySnapshot;
  posteriorSnapshot: ProbabilitySnapshot;
  mode: "APPLIED";
  status: "APPLIED";
  confidence: number;
  explanations: string[];
  createdAt: Date;
  rolledBackAt?: Date;
};

export type RollbackResult = Omit<AppliedUpdateEvent, "status" | "rolledBackAt"> & {
  status: "ROLLED_BACK";
  restoredProbabilities: ProbabilitySnapshot;
  rolledBackAt: Date;
};

function snapshotHypotheses(hypotheses: HypothesisForUpdate[]) {
  return Object.fromEntries(hypotheses.map((hypothesis) => [hypothesis.id, hypothesis.currentProbability]));
}

function averageConfidence(links: EvidenceLinkForUpdate[]) {
  if (links.length === 0) return 0;
  return links.reduce((sum, link) => sum + link.confidence, 0) / links.length;
}

function createIndependentPosterior(
  hypotheses: HypothesisForUpdate[],
  links: EvidenceLinkForUpdate[]
): ProbabilitySnapshot {
  return Object.fromEntries(
    hypotheses.map((hypothesis) => {
      const link = links.find((candidate) => candidate.hypothesisId === hypothesis.id);
      if (!link) return [hypothesis.id, hypothesis.currentProbability];
      return [
        hypothesis.id,
        updateIndependentHypothesis(hypothesis.currentProbability, link.likelihoodRatio, link.credibility)
      ];
    })
  );
}

function createMutuallyExclusivePosterior(
  hypotheses: HypothesisForUpdate[],
  links: EvidenceLinkForUpdate[]
): ProbabilitySnapshot {
  const normalizedPriors = normalizeMutuallyExclusive(hypotheses.map((hypothesis) => hypothesis.currentProbability));
  const discountedLikelihoodRatios = hypotheses.map((hypothesis) => {
    const link = links.find((candidate) => candidate.hypothesisId === hypothesis.id);
    return link ? discountLikelihoodRatio(link.likelihoodRatio, link.credibility) : 1;
  });
  const rawPosterior = normalizedPriors.map((prior, index) => prior * discountedLikelihoodRatios[index]);
  const total = rawPosterior.reduce((sum, probability) => sum + probability, 0);
  const posterior = total === 0 ? normalizedPriors : rawPosterior.map((probability) => probability / total);

  return Object.fromEntries(hypotheses.map((hypothesis, index) => [hypothesis.id, posterior[index]]));
}

export function createUpdatePreview(belief: BeliefForUpdate, links: EvidenceLinkForUpdate[]): UpdatePreview {
  const priorSnapshot = snapshotHypotheses(belief.hypotheses);
  const posteriorSnapshot =
    belief.probabilityMode === "MUTUALLY_EXCLUSIVE"
      ? createMutuallyExclusivePosterior(belief.hypotheses, links)
      : createIndependentPosterior(belief.hypotheses, links);

  return {
    beliefId: belief.id,
    mode: belief.probabilityMode,
    priorSnapshot,
    posteriorSnapshot,
    links,
    explanations: links.map((link) => `${link.hypothesisId}: ${link.rationale}`),
    reviewRequired: links.length === 0 || links.every((link) => link.confidence < 0.35),
    confidence: averageConfidence(links)
  };
}

export function applyUpdate(
  preview: UpdatePreview,
  options: { id?: string; createdAt?: Date } = {}
): AppliedUpdateEvent {
  return {
    id: options.id ?? `update-${Date.now()}`,
    beliefId: preview.beliefId,
    priorSnapshot: preview.priorSnapshot,
    posteriorSnapshot: preview.posteriorSnapshot,
    mode: "APPLIED",
    status: "APPLIED",
    confidence: preview.confidence,
    explanations: preview.explanations,
    createdAt: options.createdAt ?? new Date()
  };
}

export function rollbackUpdate(event: AppliedUpdateEvent, rolledBackAt = new Date()): RollbackResult {
  return {
    ...event,
    status: "ROLLED_BACK",
    restoredProbabilities: event.priorSnapshot,
    rolledBackAt
  };
}
