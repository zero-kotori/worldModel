const MIN_PROBABILITY = 0;
const MAX_PROBABILITY = 1;

function assertProbability(value: number, label: string) {
  if (!Number.isFinite(value) || value < MIN_PROBABILITY || value > MAX_PROBABILITY) {
    throw new RangeError(`${label} must be a finite probability between 0 and 1.`);
  }
}

function assertLikelihoodRatio(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite likelihood ratio.`);
  }
}

function assertNonNegativeWeight(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite weight.`);
  }
}

function clampProbability(value: number) {
  return Math.min(MAX_PROBABILITY, Math.max(MIN_PROBABILITY, value));
}

export function discountLikelihoodRatio(likelihoodRatio: number, credibility: number) {
  assertLikelihoodRatio(likelihoodRatio, "likelihoodRatio");
  assertProbability(credibility, "credibility");
  return 1 + credibility * (likelihoodRatio - 1);
}

export function normalizeMutuallyExclusive(probabilities: number[]) {
  if (probabilities.length === 0) {
    throw new RangeError("probabilities must not be empty.");
  }

  probabilities.forEach((probability, index) => assertNonNegativeWeight(probability, `probabilities[${index}]`));
  const total = probabilities.reduce((sum, probability) => sum + probability, 0);

  if (total === 0) {
    const equalShare = 1 / probabilities.length;
    return probabilities.map(() => equalShare);
  }

  return probabilities.map((probability) => probability / total);
}

export function updateIndependentHypothesis(prior: number, likelihoodRatio: number, credibility: number) {
  assertProbability(prior, "prior");
  const discountedLikelihoodRatio = discountLikelihoodRatio(likelihoodRatio, credibility);

  if (prior === 0 || prior === 1) {
    return prior;
  }

  const priorOdds = prior / (1 - prior);
  const posteriorOdds = priorOdds * discountedLikelihoodRatio;
  return clampProbability(posteriorOdds / (1 + posteriorOdds));
}

export function updateMutuallyExclusiveHypotheses(
  priors: number[],
  likelihoodRatios: number[],
  credibility: number
) {
  if (priors.length !== likelihoodRatios.length) {
    throw new RangeError("priors and likelihoodRatios must have the same length.");
  }

  const normalizedPriors = normalizeMutuallyExclusive(priors);
  const rawPosterior = normalizedPriors.map((prior, index) => {
    const discountedLikelihoodRatio = discountLikelihoodRatio(likelihoodRatios[index], credibility);
    return prior * discountedLikelihoodRatio;
  });
  const posteriorTotal = rawPosterior.reduce((sum, probability) => sum + probability, 0);

  if (posteriorTotal === 0) {
    return normalizedPriors;
  }

  return rawPosterior.map((probability) => probability / posteriorTotal);
}
