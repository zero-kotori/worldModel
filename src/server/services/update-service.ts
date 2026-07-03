import type { UpdateWorkflow } from "@/server/services/internal/update-workflow";
import type { WorldModelServices } from "@/server/services/types";

export function createUpdateService(
  context: { store: { listUpdateEvents: WorldModelServices["updates"]["listEvents"] } },
  updateWorkflow: UpdateWorkflow
): WorldModelServices["updates"] {
  return {
    listEvents() {
      return context.store.listUpdateEvents();
    },
    createPreview: updateWorkflow.createPreview,
    createPreviews: updateWorkflow.createPreviews,
    applyPreview: updateWorkflow.applyPreview,
    applyEvidence: updateWorkflow.applyEvidenceUpdates,
    rollback: updateWorkflow.rollbackEvent
  };
}
