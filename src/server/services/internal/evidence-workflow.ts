import { combineEstimatorOutputs } from "@/domain/likelihood";
import { createRecordId } from "@/server/services/in-memory-store";
import {
  confirmEvidenceSchema,
  connectEvidenceHypothesisSchema,
  disconnectEvidenceHypothesisSchema,
  updateEvidenceSchema
} from "@/server/services/internal/schemas";
import type { WorldModelServiceContext } from "@/server/services/internal/service-context";
import { now } from "@/server/services/internal/shared";
import type { UpdateWorkflow } from "@/server/services/internal/update-workflow";
import type {
  ConfirmAndApplyEvidenceResult,
  ConfirmEvidenceInput,
  ConnectEvidenceHypothesisInput,
  DisconnectEvidenceHypothesisInput,
  EvidenceHypothesisLinkRecord,
  EvidenceRecord,
  UpdateEvidenceInput
} from "@/server/services/types";

export type EvidenceWorkflow = {
  confirmObservation(input: ConfirmEvidenceInput): Promise<EvidenceRecord>;
  confirmAndApplyObservation(input: ConfirmEvidenceInput): Promise<ConfirmAndApplyEvidenceResult>;
  updateAndReapplyEvidence(evidenceId: string, input: UpdateEvidenceInput): Promise<ConfirmAndApplyEvidenceResult>;
  connectEvidenceHypothesis(
    evidenceId: string,
    input: ConnectEvidenceHypothesisInput
  ): Promise<ConfirmAndApplyEvidenceResult>;
  disconnectEvidenceHypothesis(
    evidenceId: string,
    input: DisconnectEvidenceHypothesisInput
  ): Promise<ConfirmAndApplyEvidenceResult>;
  rejectEvidence(evidenceId: string): Promise<EvidenceRecord>;
  deleteEvidence(evidenceId: string): Promise<EvidenceRecord>;
  listVisibleEvidence(): Promise<EvidenceRecord[]>;
};

export function createEvidenceWorkflow(
  context: WorldModelServiceContext,
  updateWorkflow: UpdateWorkflow
): EvidenceWorkflow {
  const { store } = context;

  async function confirmObservation(input: ConfirmEvidenceInput) {
    const parsed = confirmEvidenceSchema.parse(input);
    const observation = await store.getObservation(parsed.observationId);
    if (!observation) throw new Error(`Observation not found: ${parsed.observationId}`);
    if (observation.status === "REJECTED") {
      throw new Error("Rejected observations cannot be confirmed as evidence.");
    }
    const existingEvidence = (await store.listEvidence()).find((item) => item.observationId === observation.id);
    if (existingEvidence) throw new Error(`Observation is already confirmed as evidence: ${observation.title}`);

    await updateWorkflow.resolveHypothesesForLinks(parsed.links);

    const confirmedAt = now();
    const evidenceId = createRecordId("evidence");
    const links: EvidenceHypothesisLinkRecord[] = parsed.links.map((link) => ({
      id: createRecordId("evidence_link"),
      evidenceId,
      hypothesisId: link.hypothesisId,
      direction: link.direction,
      relevance: link.relevance,
      likelihoodRatio: link.likelihoodRatio,
      confidence: link.confidence,
      rationale: link.rationale,
      createdAt: confirmedAt
    }));
    const evidence = await store.createEvidence({
      id: evidenceId,
      observationId: observation.id,
      title: observation.title,
      content: observation.content,
      url: observation.url,
      confirmedAt,
      confirmationMode: parsed.confirmationMode,
      credibility: observation.credibility,
      status: "ACTIVE",
      metadata: observation.metadata,
      links
    });
    await store.updateObservation(observation.id, { status: "CONFIRMED" });
    return evidence;
  }

  async function createLikelihoodRunsForConfirmedLinks(evidence: EvidenceRecord, links: ConfirmEvidenceInput["links"]) {
    const runIdsByBeliefId = new Map<string, string[]>();
    for (const link of links) {
      if (!link.estimatorOutputs || link.estimatorOutputs.length === 0) continue;
      const hypothesis = await store.getHypothesis(link.hypothesisId);
      if (!hypothesis) throw new Error(`Hypothesis not found: ${link.hypothesisId}`);
      const ensemble = combineEstimatorOutputs(link.estimatorOutputs);
      const likelihoodRun = await store.createLikelihoodRun({
        id: createRecordId("likelihood"),
        evidenceId: evidence.id,
        hypothesisId: link.hypothesisId,
        ensembleLikelihoodRatio: ensemble.likelihoodRatio,
        ensembleConfidence: ensemble.confidence,
        estimatorOutputs: link.estimatorOutputs,
        modelVersion: ensemble.modelVersion,
        createdAt: now()
      });
      runIdsByBeliefId.set(hypothesis.beliefId, [...(runIdsByBeliefId.get(hypothesis.beliefId) ?? []), likelihoodRun.id]);
    }
    return runIdsByBeliefId;
  }

  async function confirmAndApplyObservation(input: ConfirmEvidenceInput): Promise<ConfirmAndApplyEvidenceResult> {
    const evidence = await confirmObservation(input);
    const likelihoodRunIdsByBeliefId = await createLikelihoodRunsForConfirmedLinks(evidence, input.links);
    const events = await updateWorkflow.applyEvidenceUpdates(evidence.id, undefined, likelihoodRunIdsByBeliefId);
    return { evidence, event: events[0] ?? null, events };
  }

  async function updateAndReapplyEvidence(evidenceId: string, input: UpdateEvidenceInput): Promise<ConfirmAndApplyEvidenceResult> {
    const existing = await store.getEvidence(evidenceId);
    if (!existing) throw new Error(`Evidence not found: ${evidenceId}`);
    if (existing.status === "DELETED") throw new Error(`Evidence is deleted and cannot be edited: ${existing.title}`);

    const parsed = updateEvidenceSchema.parse(input);
    if (parsed.links) {
      await updateWorkflow.resolveHypothesesForLinks(parsed.links);
    }
    await updateWorkflow.rollbackAppliedEvidenceEvents(evidenceId);
    const updatedAt = now();
    const links = parsed.links?.map((link) => ({
      id: createRecordId("evidence_link"),
      evidenceId,
      hypothesisId: link.hypothesisId,
      direction: link.direction,
      relevance: link.relevance,
      likelihoodRatio: link.likelihoodRatio,
      confidence: link.confidence,
      rationale: link.rationale,
      createdAt: updatedAt
    }));
    const evidence = await store.updateEvidence(evidenceId, {
      ...(parsed.title !== undefined ? { title: parsed.title.trim() } : {}),
      ...(parsed.content !== undefined ? { content: parsed.content.trim() } : {}),
      ...(parsed.url !== undefined ? { url: parsed.url } : {}),
      ...(parsed.credibility !== undefined ? { credibility: parsed.credibility } : {}),
      ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
      status: "ACTIVE",
      ...(links ? { links } : {})
    });
    await store.updateObservation(existing.observationId, {
      ...(parsed.title !== undefined ? { title: parsed.title.trim() } : {}),
      ...(parsed.content !== undefined ? { content: parsed.content.trim() } : {}),
      ...(parsed.url !== undefined ? { url: parsed.url } : {}),
      ...(parsed.credibility !== undefined ? { credibility: parsed.credibility } : {}),
      ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
      status: "CONFIRMED"
    });
    const likelihoodRunIdsByBeliefId = parsed.links
      ? await createLikelihoodRunsForConfirmedLinks(evidence, parsed.links)
      : new Map<string, string[]>();
    const events = await updateWorkflow.applyEvidenceUpdates(evidence.id, undefined, likelihoodRunIdsByBeliefId);
    return { evidence, event: events[0] ?? null, events };
  }

  async function connectEvidenceHypothesis(
    evidenceId: string,
    input: ConnectEvidenceHypothesisInput
  ): Promise<ConfirmAndApplyEvidenceResult> {
    const evidence = await store.getEvidence(evidenceId);
    if (!evidence) throw new Error(`Evidence not found: ${evidenceId}`);
    const hypothesis = await store.getHypothesis(input.hypothesisId);
    if (!hypothesis) throw new Error(`Hypothesis not found: ${input.hypothesisId}`);
    const parsed = connectEvidenceHypothesisSchema.parse(input);
    const links = new Map(evidence.links.map((link) => [link.hypothesisId, link]));
    links.set(parsed.hypothesisId, {
      id: createRecordId("evidence_link"),
      evidenceId,
      hypothesisId: parsed.hypothesisId,
      direction: parsed.direction,
      relevance: parsed.relevance,
      likelihoodRatio: parsed.likelihoodRatio,
      confidence: parsed.confidence,
      rationale: parsed.rationale,
      createdAt: now()
    });

    return updateAndReapplyEvidence(evidenceId, {
      title: evidence.title,
      content: evidence.content,
      url: evidence.url,
      credibility: evidence.credibility,
      metadata: evidence.metadata,
      links: [...links.values()].map((link) => ({
        hypothesisId: link.hypothesisId,
        direction: link.direction,
        relevance: link.relevance,
        likelihoodRatio: link.likelihoodRatio,
        confidence: link.confidence,
        rationale: link.rationale
      }))
    });
  }

  async function disconnectEvidenceHypothesis(
    evidenceId: string,
    input: DisconnectEvidenceHypothesisInput
  ): Promise<ConfirmAndApplyEvidenceResult> {
    const evidence = await store.getEvidence(evidenceId);
    if (!evidence) throw new Error(`Evidence not found: ${evidenceId}`);
    const parsed = disconnectEvidenceHypothesisSchema.parse(input);
    const remainingLinks = evidence.links.filter((link) => link.hypothesisId !== parsed.hypothesisId);
    if (remainingLinks.length === evidence.links.length) {
      throw new Error(`Evidence is not linked to hypothesis: ${parsed.hypothesisId}`);
    }

    return updateAndReapplyEvidence(evidenceId, {
      title: evidence.title,
      content: evidence.content,
      url: evidence.url,
      credibility: evidence.credibility,
      metadata: evidence.metadata,
      links: remainingLinks.map((link) => ({
        hypothesisId: link.hypothesisId,
        direction: link.direction,
        relevance: link.relevance,
        likelihoodRatio: link.likelihoodRatio,
        confidence: link.confidence,
        rationale: link.rationale
      }))
    });
  }

  async function rejectEvidence(evidenceId: string) {
    const existing = await store.getEvidence(evidenceId);
    if (!existing) throw new Error(`Evidence not found: ${evidenceId}`);
    await updateWorkflow.rollbackAppliedEvidenceEvents(evidenceId);
    await store.updateObservation(existing.observationId, { status: "REJECTED" });
    return store.updateEvidence(evidenceId, { status: "REJECTED" });
  }

  async function deleteEvidence(evidenceId: string) {
    const existing = await store.getEvidence(evidenceId);
    if (!existing) throw new Error(`Evidence not found: ${evidenceId}`);
    if (existing.status === "DELETED") return existing;
    await updateWorkflow.rollbackAppliedEvidenceEvents(evidenceId);
    await store.updateObservation(existing.observationId, { status: "REJECTED" });
    return store.updateEvidence(evidenceId, { status: "DELETED" });
  }

  async function listVisibleEvidence() {
    return (await store.listEvidence()).filter((evidence) => evidence.status !== "DELETED");
  }

  return {
    confirmObservation,
    confirmAndApplyObservation,
    updateAndReapplyEvidence,
    connectEvidenceHypothesis,
    disconnectEvidenceHypothesis,
    rejectEvidence,
    deleteEvidence,
    listVisibleEvidence
  };
}
