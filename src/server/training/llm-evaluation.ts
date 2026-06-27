import type { EstimatorOutput } from "@/domain/likelihood";
import type { TrainingLabel, TrainingSample } from "@/server/training/training-data";

export type LlmEvaluationItem = {
  sample: TrainingSample;
  llm: EstimatorOutput;
  fallback?: EstimatorOutput;
};

type AccuracyBucket = {
  total: number;
  scored: number;
  correct: number;
  accuracy: number | null;
};

export type LlmEvaluationSummary = {
  modelName: string;
  sampleCount: number;
  scoredCount: number;
  sourceCounts: Record<string, number>;
  directionAccuracy: Record<TrainingLabel, AccuracyBucket>;
  likelihoodRatio: {
    min: number | null;
    max: number | null;
    mean: number | null;
  };
  lowConfidenceCount: number;
  lowConfidenceRate: number;
  reviewRequiredCount: number;
  reviewRequiredRate: number;
  fallbackComparedCount: number;
  fallbackDivergenceCount: number;
  fallbackDivergenceRate: number | null;
};

const labels: TrainingLabel[] = ["SUPPORTS", "OPPOSES", "NEUTRAL"];

function outputDirection(output: EstimatorOutput): TrainingLabel | null {
  if (output.abstain) return null;
  if (output.direction === "SUPPORTS" || output.direction === "OPPOSES" || output.direction === "NEUTRAL") {
    return output.direction;
  }
  const likelihoodRatio = output.likelihoodRatio;
  if (!likelihoodRatio || !Number.isFinite(likelihoodRatio)) return null;
  if (likelihoodRatio > 1.1) return "SUPPORTS";
  if (likelihoodRatio < 0.9) return "OPPOSES";
  return "NEUTRAL";
}

function emptyAccuracy(): Record<TrainingLabel, AccuracyBucket> {
  return {
    SUPPORTS: { total: 0, scored: 0, correct: 0, accuracy: null },
    OPPOSES: { total: 0, scored: 0, correct: 0, accuracy: null },
    NEUTRAL: { total: 0, scored: 0, correct: 0, accuracy: null }
  };
}

function ratio(count: number, total: number) {
  return total === 0 ? 0 : count / total;
}

export function summarizeLlmEvaluation(
  items: LlmEvaluationItem[],
  options: { modelName: string; lowConfidenceThreshold?: number }
): LlmEvaluationSummary {
  const lowConfidenceThreshold = options.lowConfidenceThreshold ?? 0.5;
  const directionAccuracy = emptyAccuracy();
  const likelihoodRatios: number[] = [];
  let scoredCount = 0;
  let lowConfidenceCount = 0;
  let reviewRequiredCount = 0;
  let fallbackComparedCount = 0;
  let fallbackDivergenceCount = 0;
  const sourceCounts: Record<string, number> = {};

  for (const item of items) {
    const expected = item.sample.label;
    const predicted = outputDirection(item.llm);
    let itemRequiresReview = item.llm.reviewRequired === true;
    sourceCounts[item.sample.source] = (sourceCounts[item.sample.source] ?? 0) + 1;
    directionAccuracy[expected].total += 1;

    if (!predicted) {
      itemRequiresReview = true;
    } else {
      scoredCount += 1;
      directionAccuracy[expected].scored += 1;
      if (predicted === expected) directionAccuracy[expected].correct += 1;
    }

    if (item.llm.likelihoodRatio && Number.isFinite(item.llm.likelihoodRatio)) {
      likelihoodRatios.push(item.llm.likelihoodRatio);
    }

    const confidence = item.llm.confidence ?? 0;
    if (!item.llm.abstain && confidence < lowConfidenceThreshold) {
      lowConfidenceCount += 1;
      itemRequiresReview = true;
    }

    if (itemRequiresReview) reviewRequiredCount += 1;

    const fallbackDirection = item.fallback ? outputDirection(item.fallback) : null;
    if (predicted && fallbackDirection && fallbackDirection !== "NEUTRAL") {
      fallbackComparedCount += 1;
      if (predicted !== fallbackDirection) fallbackDivergenceCount += 1;
    }
  }

  for (const label of labels) {
    const bucket = directionAccuracy[label];
    bucket.accuracy = bucket.scored === 0 ? null : bucket.correct / bucket.scored;
  }

  return {
    modelName: options.modelName,
    sampleCount: items.length,
    scoredCount,
    sourceCounts,
    directionAccuracy,
    likelihoodRatio: {
      min: likelihoodRatios.length ? Math.min(...likelihoodRatios) : null,
      max: likelihoodRatios.length ? Math.max(...likelihoodRatios) : null,
      mean: likelihoodRatios.length ? likelihoodRatios.reduce((sum, value) => sum + value, 0) / likelihoodRatios.length : null
    },
    lowConfidenceCount,
    lowConfidenceRate: ratio(lowConfidenceCount, items.length),
    reviewRequiredCount,
    reviewRequiredRate: ratio(reviewRequiredCount, items.length),
    fallbackComparedCount,
    fallbackDivergenceCount,
    fallbackDivergenceRate: fallbackComparedCount === 0 ? null : fallbackDivergenceCount / fallbackComparedCount
  };
}
