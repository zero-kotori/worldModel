import { deduplicateObservation, type ObservationForDedupe } from "@/domain/dedupe";
import { createRecordId } from "@/server/services/in-memory-store";
import {
  createObservationSchema,
  updateObservationSchema
} from "@/server/services/internal/schemas";
import type { EvidenceLinkRecommendationOptions, EvidenceLinkRecommendationResult } from "@/server/services/internal/candidate-types";
import type { WorldModelServiceContext } from "@/server/services/internal/service-context";
import { DEFAULT_CANDIDATE_THRESHOLD, now } from "@/server/services/internal/shared";
import type {
  CreateObservationInput,
  HypothesisRecord,
  ObservationRecord,
  RawObservationInput,
  SettleObservationInput,
  UpdateHypothesisInput,
  UpdateObservationInput
} from "@/server/services/types";

export type ObservationWorkflowDependencies = {
  recommendedEvidenceLinks(
    observation: ObservationRecord,
    threshold: number,
    options?: EvidenceLinkRecommendationOptions
  ): Promise<EvidenceLinkRecommendationResult>;
  updateHypothesisRecord(hypothesisId: string, input: UpdateHypothesisInput): Promise<HypothesisRecord>;
};

export type ObservationWorkflow = {
  createObservation(input: CreateObservationInput): Promise<ObservationRecord>;
  updateObservation(observationId: string, input: UpdateObservationInput): Promise<ObservationRecord>;
  rejectObservation(observationId: string): Promise<ObservationRecord>;
  deleteObservation(observationId: string): Promise<ObservationRecord>;
  settleObservation(input: SettleObservationInput): Promise<{ observation: ObservationRecord; hypothesis: HypothesisRecord }>;
  toDedupeObservation(observation: RawObservationInput | CreateObservationInput): ObservationForDedupe;
};

export function toDedupeObservation(observation: RawObservationInput | CreateObservationInput): ObservationForDedupe {
  return {
    title: observation.title,
    content: observation.content,
    url: observation.url,
    observedAt: new Date(),
    publishedAt: observation.publishedAt
  };
}

export function metadataText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function createObservationWorkflow(
  context: WorldModelServiceContext,
  dependencies: ObservationWorkflowDependencies
): ObservationWorkflow {
  const { store } = context;

  async function createObservation(input: CreateObservationInput) {
    const parsed = createObservationSchema.parse(input);
    const existing = await store.listObservations();
    const decision = deduplicateObservation(
      {
        ...toDedupeObservation(parsed),
        normalizedHash: parsed.normalizedHash,
        semanticKey: parsed.semanticKey
      },
      existing
    );
    const observedAt = now();
    return store.createObservation({
      id: createRecordId("observation"),
      sourceId: parsed.sourceId,
      title: parsed.title.trim(),
      content: parsed.content.trim(),
      url: parsed.url,
      author: parsed.author,
      publishedAt: parsed.publishedAt,
      observedAt,
      normalizedHash: parsed.normalizedHash,
      semanticKey: parsed.semanticKey,
      status: decision.duplicate ? "DUPLICATE" : "PENDING",
      duplicateOfId: decision.duplicateOfId,
      credibility: parsed.credibility ?? 0.5,
      metadata: parsed.metadata ?? {}
    });
  }

  async function updateObservation(observationId: string, input: UpdateObservationInput) {
    const observation = await store.getObservation(observationId);
    if (!observation) throw new Error(`Observation not found: ${observationId}`);
    const parsed = updateObservationSchema.parse(input);
    const isSourceOnlyPatch = Object.keys(parsed).every((key) => key === "sourceId");
    if (observation.status === "CONFIRMED" && !isSourceOnlyPatch) {
      throw new Error("Confirmed observations must be edited from the evidence record.");
    }
    if (parsed.sourceId) {
      const source = await store.getSource(parsed.sourceId);
      if (!source) throw new Error(`Source not found: ${parsed.sourceId}`);
    }
    const patch: Partial<ObservationRecord> = {
      ...(parsed.sourceId !== undefined ? { sourceId: parsed.sourceId ?? undefined } : {}),
      ...(parsed.title !== undefined ? { title: parsed.title.trim() } : {}),
      ...(parsed.content !== undefined ? { content: parsed.content.trim() } : {}),
      ...(parsed.url !== undefined ? { url: parsed.url } : {}),
      ...(parsed.author !== undefined ? { author: parsed.author } : {}),
      ...(parsed.credibility !== undefined ? { credibility: parsed.credibility } : {}),
      ...(parsed.normalizedHash !== undefined ? { normalizedHash: parsed.normalizedHash } : {}),
      ...(parsed.semanticKey !== undefined ? { semanticKey: parsed.semanticKey } : {}),
      ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {})
    };
    const shouldRefreshRecommendations =
      observation.status !== "DUPLICATE" &&
      observation.status !== "REJECTED" &&
      (parsed.title !== undefined || parsed.content !== undefined || parsed.credibility !== undefined);

    if (shouldRefreshRecommendations) {
      const updatedObservation = { ...observation, ...patch, metadata: patch.metadata ?? observation.metadata };
      const recommendation = await dependencies.recommendedEvidenceLinks(updatedObservation, DEFAULT_CANDIDATE_THRESHOLD);
      const links = recommendation.links;
      const metadata = { ...(patch.metadata ?? observation.metadata) };
      const wasCandidateLifecycle =
        observation.status === "UNKNOWN" ||
        Array.isArray(metadata.recommendedLinks) ||
        typeof metadata.reviewReason === "string";
      delete metadata.recommendedLinks;
      delete metadata.reviewReason;
      delete metadata.candidateEvaluation;

      if (links.length > 0) {
        delete metadata.ignoredReason;
        metadata.recommendedLinks = links;
        metadata.reviewReason = "OBSERVATION_EDIT";
        if (observation.status === "UNKNOWN") patch.status = "PENDING";
      } else if (wasCandidateLifecycle) {
        metadata.ignoredReason = "UNMATCHED";
        if (recommendation.candidateEvaluation) {
          metadata.candidateEvaluation = recommendation.candidateEvaluation;
        }
        patch.status = "UNKNOWN";
      }

      patch.metadata = metadata;
    }

    return store.updateObservation(observation.id, patch);
  }

  async function rejectObservation(observationId: string) {
    const observation = await store.getObservation(observationId);
    if (!observation) throw new Error(`Observation not found: ${observationId}`);
    if (observation.status === "CONFIRMED") {
      throw new Error("Confirmed observations must be rejected from the evidence record.");
    }
    return store.updateObservation(observation.id, { status: "REJECTED" });
  }

  async function deleteObservation(observationId: string) {
    const observation = await store.getObservation(observationId);
    if (!observation) throw new Error(`Observation not found: ${observationId}`);
    if (observation.status === "CONFIRMED") {
      throw new Error("Confirmed observations must be deleted from the evidence record.");
    }
    return store.updateObservation(observation.id, { status: "DELETED" });
  }

  async function settleObservation(input: SettleObservationInput) {
    const observation = await store.getObservation(input.observationId);
    if (!observation) throw new Error(`Observation not found: ${input.observationId}`);
    if (observation.metadata.reviewReason !== "SETTLEMENT_REVIEW") {
      throw new Error("Only settlement review observations can settle hypotheses.");
    }
    const metadataHypothesisId =
      metadataText(observation.metadata.settlementHypothesisId) || metadataText(observation.metadata.queryHypothesisId);
    if (metadataHypothesisId && metadataHypothesisId !== input.hypothesisId) {
      throw new Error("Settlement observation target does not match the submitted hypothesis.");
    }
    const resolvedOutcome = input.resolvedOutcome?.trim() || observation.content || observation.title;
    const hypothesis = await dependencies.updateHypothesisRecord(input.hypothesisId, {
      status: input.outcome,
      currentProbability: input.outcome === "RESOLVED_TRUE" ? 1 : 0,
      resolvedOutcome
    });
    const settledObservation = await store.updateObservation(observation.id, {
      status: "SETTLED",
      metadata: {
        ...observation.metadata,
        settlementResolved: true,
        settlementOutcome: input.outcome,
        settlementResolvedHypothesisId: input.hypothesisId,
        settlementResolvedOutcome: resolvedOutcome,
        settlementResolvedAt: now().toISOString()
      }
    });

    return { observation: settledObservation, hypothesis };
  }

  return {
    createObservation,
    updateObservation,
    rejectObservation,
    deleteObservation,
    settleObservation,
    toDedupeObservation
  };
}
