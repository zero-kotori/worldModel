import { combineEstimatorOutputs } from "@/domain/likelihood";
import { createRecordId } from "@/server/services/in-memory-store";
import type { WorldModelServiceContext } from "@/server/services/internal/service-context";
import { now } from "@/server/services/internal/shared";
import type { RunLikelihoodInput, WorldModelServices } from "@/server/services/types";

export function createLikelihoodService(context: WorldModelServiceContext): WorldModelServices["likelihood"] {
  const { store } = context;

  return {
    async runLikelihood(input: RunLikelihoodInput) {
      const evidence = await store.getEvidence(input.evidenceId);
      if (!evidence) throw new Error(`Evidence not found: ${input.evidenceId}`);
      const hypothesis = await store.getHypothesis(input.hypothesisId);
      if (!hypothesis) throw new Error(`Hypothesis not found: ${input.hypothesisId}`);
      const ensemble = combineEstimatorOutputs(input.outputs);
      return store.createLikelihoodRun({
        id: createRecordId("likelihood"),
        evidenceId: input.evidenceId,
        hypothesisId: input.hypothesisId,
        ensembleLikelihoodRatio: ensemble.likelihoodRatio,
        ensembleConfidence: ensemble.confidence,
        estimatorOutputs: input.outputs,
        modelVersion: ensemble.modelVersion,
        createdAt: now()
      });
    },
    listRuns() {
      return store.listLikelihoodRuns();
    }
  };
}
