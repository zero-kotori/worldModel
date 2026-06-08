import { createConfiguredLlmEstimator } from "@/server/models/estimators";
import { createWorldModelServices, type WorldModelServiceOptions } from "@/server/services/world-model-services";
import type { WorldModelStore } from "@/server/services/types";

export type ConfiguredWorldModelServiceOptions = Omit<WorldModelServiceOptions, "likelihoodEstimator"> & {
  env?: Record<string, string | undefined>;
  llmFetch?: typeof fetch;
};

export function createConfiguredWorldModelServices(
  store: WorldModelStore,
  options: ConfiguredWorldModelServiceOptions = {}
) {
  return createWorldModelServices(store, {
    sourceAdapterDependencies: options.sourceAdapterDependencies,
    likelihoodEstimator: createConfiguredLlmEstimator(options.env, options.llmFetch)
  });
}
