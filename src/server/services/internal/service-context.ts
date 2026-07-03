import type { LikelihoodEstimator } from "@/server/models/estimators";
import type { AdapterDependencies } from "@/server/sources/adapters";
import type { HypothesisRecommendationGenerator, WorldModelStore } from "@/server/services/types";

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

export type WorldModelServiceContext = {
  store: WorldModelStore;
  options: WorldModelServiceOptions;
  applyAutoApplyPolicy(input: AutoApplyPolicyInput): Promise<AutoApplyPolicyInput>;
};

export function createWorldModelServiceContext(
  store: WorldModelStore,
  options: WorldModelServiceOptions = {}
): WorldModelServiceContext {
  return {
    store,
    options,
    async applyAutoApplyPolicy(input) {
      return options.autoApplyPolicy ? options.autoApplyPolicy(input) : input;
    }
  };
}
