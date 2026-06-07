import type { BeliefCategory } from "@/server/services/types";
import type { EstimatorOutput } from "@/domain/likelihood";

export type EstimatorInput = {
  evidenceText: string;
  hypothesis: string;
  category: BeliefCategory;
  sourceCredibility: number;
  context?: string;
};

export type LikelihoodEstimator = {
  name: string;
  estimate(input: EstimatorInput): Promise<EstimatorOutput>;
};

export type LightweightArtifact = {
  version: string;
  supportTerms: string[];
  opposeTerms: string[];
};

function countTerms(text: string, terms: string[]) {
  const normalized = text.toLowerCase();
  return terms.filter((term) => normalized.includes(term.toLowerCase())).length;
}

export function createLightweightEstimator(artifact: LightweightArtifact | null): LikelihoodEstimator {
  return {
    name: "lightweight",
    async estimate(input) {
      if (!artifact) {
        return {
          estimator: "lightweight",
          weight: 1,
          abstain: true,
          rationale: "No lightweight artifact is registered."
        };
      }

      const supportCount = countTerms(input.evidenceText, artifact.supportTerms);
      const opposeCount = countTerms(input.evidenceText, artifact.opposeTerms);
      const score = supportCount - opposeCount;
      const likelihoodRatio = Math.max(0.2, Math.min(5, 1 + score * 0.45 * input.sourceCredibility));

      return {
        estimator: "lightweight",
        likelihoodRatio,
        confidence: Math.min(1, 0.35 + Math.abs(score) * 0.18 + input.sourceCredibility * 0.25),
        weight: 1,
        rationale: `Matched ${supportCount} support terms and ${opposeCount} oppose terms for ${input.category}.`,
        modelVersion: artifact.version,
        abstain: false
      };
    }
  };
}

export function createLlmEstimator(config: {
  provider: "deepseek" | "openai" | "local";
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}): LikelihoodEstimator {
  return {
    name: "llm",
    async estimate() {
      if (!config.apiKey || !config.model) {
        return {
          estimator: "llm",
          weight: 1,
          abstain: true,
          rationale: "LLM provider, model, or API key is not configured."
        };
      }

      return {
        estimator: "llm",
        weight: 1,
        abstain: true,
        rationale: "LLM scoring is configured but network scoring is disabled in this server-side dry run.",
        modelVersion: `${config.provider}:${config.model}`
      };
    }
  };
}

export function createExternalModelEstimator(config: { endpoint?: string; version?: string }): LikelihoodEstimator {
  return {
    name: "external-deep-model",
    async estimate() {
      if (!config.endpoint) {
        return {
          estimator: "external-deep-model",
          weight: 1,
          abstain: true,
          rationale: "External model endpoint is not configured."
        };
      }

      return {
        estimator: "external-deep-model",
        weight: 1,
        abstain: true,
        rationale: "External model endpoint is registered but not called during local dry run.",
        modelVersion: config.version ?? "external:unversioned"
      };
    }
  };
}
