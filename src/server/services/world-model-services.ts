import { createAutomationService } from "@/server/services/automation-service";
import { createBeliefService } from "@/server/services/belief-service";
import { createEvidenceService } from "@/server/services/evidence-service";
import { createLikelihoodService } from "@/server/services/likelihood-service";
import { createModelService } from "@/server/services/model-service";
import { createObservationService } from "@/server/services/observation-service";
import { createSourceService } from "@/server/services/source-service";
import { createUpdateService } from "@/server/services/update-service";
import { createBeliefWorkflow, type BeliefWorkflow } from "@/server/services/internal/belief-workflow";
import { createEvidenceWorkflow } from "@/server/services/internal/evidence-workflow";
import { createObservationWorkflow } from "@/server/services/internal/observation-workflow";
import {
  createWorldModelServiceContext,
  type WorldModelServiceOptions
} from "@/server/services/internal/service-context";
import { createSourceWorkflow, type SourceWorkflow } from "@/server/services/internal/source-workflow";
import { createUpdateWorkflow } from "@/server/services/internal/update-workflow";
import type { WorldModelServices, WorldModelStore } from "@/server/services/types";

export type { AutoApplyPolicyInput, WorldModelServiceOptions } from "@/server/services/internal/service-context";

export function createWorldModelServices(
  store: WorldModelStore,
  options: WorldModelServiceOptions = {}
): WorldModelServices {
  const context = createWorldModelServiceContext(store, options);
  const updateWorkflow = createUpdateWorkflow(context);
  const evidenceWorkflow = createEvidenceWorkflow(context, updateWorkflow);
  const sourceWorkflowRef: { current?: SourceWorkflow } = {};
  const beliefWorkflowRef: { current?: BeliefWorkflow } = {};

  function sourceWorkflow() {
    if (!sourceWorkflowRef.current) throw new Error("Source workflow has not been initialized.");
    return sourceWorkflowRef.current;
  }

  function beliefWorkflow() {
    if (!beliefWorkflowRef.current) throw new Error("Belief workflow has not been initialized.");
    return beliefWorkflowRef.current;
  }

  const observationWorkflow = createObservationWorkflow(context, {
    recommendedEvidenceLinks(...args) {
      return sourceWorkflow().recommendedEvidenceLinks(...args);
    },
    updateHypothesisRecord(...args) {
      return beliefWorkflow().updateHypothesisRecord(...args);
    }
  });

  sourceWorkflowRef.current = createSourceWorkflow(context, {
    createObservation: observationWorkflow.createObservation,
    confirmAndApplyObservation: evidenceWorkflow.confirmAndApplyObservation,
    createCandidatePreview: updateWorkflow.createCandidatePreview
  });

  beliefWorkflowRef.current = createBeliefWorkflow(context, {
    updateWorkflow,
    requeueUnmatchedObservationsForHypothesis(...args) {
      return sourceWorkflow().requeueUnmatchedObservationsForHypothesis(...args);
    },
    requeueSourceObservationForRecommendedHypotheses(...args) {
      return sourceWorkflow().requeueSourceObservationForRecommendedHypotheses(...args);
    },
    requeueSourceObservationForRecommendedHypothesis(...args) {
      return sourceWorkflow().requeueSourceObservationForRecommendedHypothesis(...args);
    }
  });

  return {
    beliefs: createBeliefService(context, beliefWorkflow()),
    observations: createObservationService(context, observationWorkflow),
    evidence: createEvidenceService(evidenceWorkflow),
    likelihood: createLikelihoodService(context),
    updates: createUpdateService(context, updateWorkflow),
    sources: createSourceService(context, sourceWorkflow(), observationWorkflow),
    automation: createAutomationService(context, sourceWorkflow()),
    models: createModelService(context)
  };
}
