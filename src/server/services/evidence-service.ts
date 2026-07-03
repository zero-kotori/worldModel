import type { EvidenceWorkflow } from "@/server/services/internal/evidence-workflow";
import type { WorldModelServices } from "@/server/services/types";

export function createEvidenceService(evidenceWorkflow: EvidenceWorkflow): WorldModelServices["evidence"] {
  return {
    confirmObservation: evidenceWorkflow.confirmObservation,
    confirmAndApplyObservation: evidenceWorkflow.confirmAndApplyObservation,
    updateAndReapply: evidenceWorkflow.updateAndReapplyEvidence,
    connectHypothesis: evidenceWorkflow.connectEvidenceHypothesis,
    disconnectHypothesis: evidenceWorkflow.disconnectEvidenceHypothesis,
    reject: evidenceWorkflow.rejectEvidence,
    deleteEvidence: evidenceWorkflow.deleteEvidence,
    listEvidence: evidenceWorkflow.listVisibleEvidence
  };
}
