import type { BeliefWorkflow } from "@/server/services/internal/belief-workflow";
import type { WorldModelServiceContext } from "@/server/services/internal/service-context";
import type { WorldModelServices } from "@/server/services/types";

export function createBeliefService(
  context: WorldModelServiceContext,
  beliefWorkflow: BeliefWorkflow
): WorldModelServices["beliefs"] {
  return {
    createBelief: beliefWorkflow.createBelief,
    updateBelief: beliefWorkflow.updateBeliefRecord,
    createHypothesis: beliefWorkflow.createHypothesis,
    updateHypothesis: beliefWorkflow.updateHypothesisRecord,
    recommendHypotheses: beliefWorkflow.recommendHypotheses,
    listBeliefs() {
      return context.store.listBeliefs();
    },
    getBelief(id) {
      return context.store.getBelief(id);
    }
  };
}
