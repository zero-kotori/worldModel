import type { ObservationWorkflow } from "@/server/services/internal/observation-workflow";
import type { WorldModelServiceContext } from "@/server/services/internal/service-context";
import type { WorldModelServices } from "@/server/services/types";

export function createObservationService(
  context: WorldModelServiceContext,
  observationWorkflow: ObservationWorkflow
): WorldModelServices["observations"] {
  return {
    createObservation: observationWorkflow.createObservation,
    updateObservation: observationWorkflow.updateObservation,
    rejectObservation: observationWorkflow.rejectObservation,
    deleteObservation: observationWorkflow.deleteObservation,
    settleObservation: observationWorkflow.settleObservation,
    listObservations() {
      return context.store.listObservations();
    }
  };
}
