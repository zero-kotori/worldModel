export type EstimatorOutput = {
  estimator: string;
  direction?: "SUPPORTS" | "OPPOSES" | "MIXED" | "NEUTRAL";
  relevance?: number;
  likelihoodRatio?: number;
  confidence?: number;
  weight: number;
  rationale?: string;
  abstain?: boolean;
  modelVersion?: string;
};

export type EnsembleLikelihood = {
  likelihoodRatio: number;
  confidence: number;
  reviewRequired: boolean;
  usedEstimators: string[];
  rationale: string;
  modelVersion: string;
  estimatorOutputs: EstimatorOutput[];
};

function isUsableOutput(output: EstimatorOutput) {
  return (
    !output.abstain &&
    Number.isFinite(output.likelihoodRatio) &&
    Number.isFinite(output.confidence) &&
    Number.isFinite(output.weight) &&
    output.weight > 0 &&
    output.confidence !== undefined &&
    output.confidence > 0 &&
    output.confidence <= 1 &&
    output.likelihoodRatio !== undefined &&
    output.likelihoodRatio > 0
  );
}

export function combineEstimatorOutputs(outputs: EstimatorOutput[]): EnsembleLikelihood {
  const usableOutputs = outputs.filter(isUsableOutput);

  if (usableOutputs.length === 0) {
    return {
      likelihoodRatio: 1,
      confidence: 0,
      reviewRequired: true,
      usedEstimators: [],
      rationale: "All estimators abstained or returned invalid likelihood output.",
      modelVersion: "ensemble:none",
      estimatorOutputs: outputs
    };
  }

  const effectiveWeightTotal = usableOutputs.reduce(
    (sum, output) => sum + output.weight * (output.confidence ?? 0),
    0
  );
  const configuredWeightTotal = usableOutputs.reduce((sum, output) => sum + output.weight, 0);
  const weightedLogLikelihood = usableOutputs.reduce((sum, output) => {
    return sum + Math.log(output.likelihoodRatio ?? 1) * output.weight * (output.confidence ?? 0);
  }, 0);

  return {
    likelihoodRatio: Math.exp(weightedLogLikelihood / effectiveWeightTotal),
    confidence: effectiveWeightTotal / configuredWeightTotal,
    reviewRequired: false,
    usedEstimators: usableOutputs.map((output) => output.estimator),
    rationale: usableOutputs
      .map((output) => `${output.estimator}: ${output.rationale ?? "no rationale supplied"}`)
      .join("\n"),
    modelVersion: usableOutputs.map((output) => output.modelVersion ?? `${output.estimator}:unversioned`).join("+"),
    estimatorOutputs: outputs
  };
}
