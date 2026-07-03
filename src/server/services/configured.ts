import {
  createCompositeLikelihoodEstimator,
  createConfiguredLlmEstimator,
  createExternalModelEstimator
} from "@/server/models/estimators";
import { createConfiguredLlmHypothesisRecommendationGenerator } from "@/server/models/hypothesis-recommendations";
import { guardAutoApplyWithLlmEvaluation } from "@/server/automation/auto-apply-policy";
import { isHypothesisCurrentlyEffective } from "@/lib/world-model-beliefs-ui";
import { isLlmHypothesisRecommendationsDisabled, normalizeExternalModelConfig } from "@/lib/world-model-llm-config";
import { sourceEvidenceQualityAutoApplyRisk } from "@/lib/world-model-sources-ui";
import { createWorldModelServices, type WorldModelServiceOptions } from "@/server/services/world-model-services";
import type { WorldModelStore } from "@/server/services/types";

export type ConfiguredWorldModelServiceOptions = Omit<WorldModelServiceOptions, "likelihoodEstimator"> & {
  env?: Record<string, string | undefined>;
  llmFetch?: typeof fetch;
};

type AutoApplyPolicyInput = Parameters<NonNullable<WorldModelServiceOptions["autoApplyPolicy"]>>[0];

function reviewOnlyPolicy(input: AutoApplyPolicyInput, reviewReason?: string): AutoApplyPolicyInput {
  return {
    ...input,
    reviewOnly: true,
    autoConfirm: false,
    reviewReason: reviewReason ?? input.reviewReason
  };
}

async function guardAutoApplyCoverage(store: WorldModelStore, input: AutoApplyPolicyInput) {
  if (!input.autoConfirm) return input;

  const requestedBeliefIds = new Set(input.beliefIds?.filter(Boolean) ?? []);
  const activeBeliefs = (await store.listBeliefs()).filter(
    (belief) => belief.status === "ACTIVE" && (requestedBeliefIds.size === 0 || requestedBeliefIds.has(belief.id))
  );
  const effectiveBeliefCoverage = activeBeliefs.map((belief) => {
    const effectiveHypotheses = belief.hypotheses.filter((hypothesis) => isHypothesisCurrentlyEffective(hypothesis));
    return {
      hasEffective: effectiveHypotheses.length > 0,
      hasSupport: effectiveHypotheses.some((hypothesis) => hypothesis.stance === "SUPPORTS"),
      hasOppose: effectiveHypotheses.some((hypothesis) => hypothesis.stance === "OPPOSES")
    };
  });

  if (!effectiveBeliefCoverage.some((coverage) => coverage.hasEffective)) return reviewOnlyPolicy(input, "NO_EFFECTIVE_HYPOTHESIS");
  if (effectiveBeliefCoverage.some((coverage) => (coverage.hasSupport || coverage.hasOppose) && coverage.hasSupport !== coverage.hasOppose)) {
    return reviewOnlyPolicy(input, "ONE_SIDED_HYPOTHESIS_COVERAGE");
  }

  return input;
}

async function guardAutoApplySourceEvidenceQuality(store: WorldModelStore, input: AutoApplyPolicyInput) {
  if (!input.autoConfirm) return input;

  const [sources, observations, evidence, updates] = await Promise.all([
    store.listSources(),
    store.listObservations(),
    store.listEvidence(),
    store.listUpdateEvents()
  ]);
  const risk = sourceEvidenceQualityAutoApplyRisk({
    sources,
    observations,
    evidence,
    updates,
    sourceIds: input.sourceIds
  });

  return risk ? reviewOnlyPolicy(input, "SOURCE_EVIDENCE_QUALITY_RISK") : input;
}

export function createConfiguredWorldModelServices(
  store: WorldModelStore,
  options: ConfiguredWorldModelServiceOptions = {}
) {
  const llmEstimator = createConfiguredLlmEstimator(options.env, options.llmFetch);
  const externalConfig = normalizeExternalModelConfig(options.env);
  const likelihoodEstimator =
    externalConfig.endpoint && externalConfig.model
      ? createCompositeLikelihoodEstimator([
          llmEstimator,
          createExternalModelEstimator({
            endpoint: externalConfig.endpoint,
            apiKey: externalConfig.apiKey,
            model: externalConfig.model,
            version: externalConfig.version,
            fetch: options.llmFetch,
            timeoutMs: externalConfig.timeoutMs ?? 30_000
          })
        ])
      : llmEstimator;

  return createWorldModelServices(store, {
    sourceAdapterDependencies: options.sourceAdapterDependencies,
    likelihoodEstimator,
    hypothesisRecommendationGenerator:
      options.hypothesisRecommendationGenerator ??
      (isLlmHypothesisRecommendationsDisabled(options.env)
        ? undefined
        : createConfiguredLlmHypothesisRecommendationGenerator(options.env, options.llmFetch)),
    autoApplyPolicy:
      options.autoApplyPolicy ??
      (async (input) => {
        const coverageGuarded = await guardAutoApplyCoverage(store, input);
        const sourceQualityGuarded = await guardAutoApplySourceEvidenceQuality(store, coverageGuarded);
        if (sourceQualityGuarded.reviewOnly || !sourceQualityGuarded.autoConfirm) return sourceQualityGuarded;
        const guarded = await guardAutoApplyWithLlmEvaluation({
          reviewOnly: sourceQualityGuarded.reviewOnly,
          forceAutoApply: sourceQualityGuarded.autoConfirm
        });
        return {
          ...sourceQualityGuarded,
          reviewOnly: guarded.options.reviewOnly,
          autoConfirm: Boolean(guarded.options.forceAutoApply),
          reviewReason: guarded.options.reviewOnly
            ? sourceQualityGuarded.reviewReason || "LLM_EVALUATION_RISK"
            : sourceQualityGuarded.reviewReason
        };
      })
  });
}
